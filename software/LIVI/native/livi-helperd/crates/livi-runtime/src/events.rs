// Turns the phone's telemetry messages into the JSON event lines the LIVI UI consumes.

use iap2_csm::messages::communications::CallStateUpdate;
use iap2_csm::messages::communications::CommunicationsUpdate;
use iap2_csm::messages::now_playing::{NowPlayingUpdate, PlaybackStatus};
use iap2_csm::messages::power::PowerUpdate;
use iap2_csm::messages::route_guidance::RouteGuidanceUpdate;
use iap2_csm::CsmMessage;

use crate::framing::frame_msg_id;

/// The phone's transport identifiers, which tell the UI whether this session is wired.
pub fn device_json(frame: &[u8], usb_udid: Option<&str>) -> Option<String> {
    use iap2_csm::messages::car_play::DeviceTransportIdentifierNotification;

    if frame_msg_id(frame)? != 0x4E0E {
        return None;
    }
    let m = DeviceTransportIdentifierNotification::decode(frame).ok()?;
    let mut o = Obj::new("device");
    o.str("src", if usb_udid.is_some() { "carkit" } else { "bt" });
    if !m.bluetooth_transport_id.is_empty() {
        o.str("btMac", &m.bluetooth_transport_id);
    }
    if let Some(udid) = usb_udid {
        o.str("usbUdid", udid);
    }
    o.finish()
}

/// The phone's iAP2 identity, which the UI uses to route metadata to the right session.
#[derive(Debug, Default, Clone)]
pub struct EventTag {
    pub phone_id: Option<String>,
    pub cid: Option<String>,
    pub usb_transport_id: Option<String>,
}

impl EventTag {
    /// Learns the identity from a DeviceTransportIdentifierNotification.
    pub fn learn(&mut self, frame: &[u8]) {
        use iap2_csm::messages::car_play::DeviceTransportIdentifierNotification;

        if frame_msg_id(frame) != Some(0x4E0E) {
            return;
        }
        if let Ok(m) = DeviceTransportIdentifierNotification::decode(frame) {
            if !m.bluetooth_transport_id.is_empty() {
                self.phone_id = Some(m.bluetooth_transport_id);
            }
            if !m.usb_transport_id.is_empty() {
                self.usb_transport_id = Some(m.usb_transport_id);
            }
        }
    }

    /// Adds the identity to an already built event object.
    pub fn apply(&self, json: String) -> String {
        let mut extra = String::new();
        for (key, value) in [
            ("cid", self.cid.as_deref()),
            ("phoneId", self.phone_id.as_deref()),
            ("usbTransportId", self.usb_transport_id.as_deref()),
        ] {
            if let Some(v) = value {
                extra.push_str(&format!(",\"{key}\":\"{}\"", escape(v)));
            }
        }
        if extra.is_empty() || !json.ends_with('}') {
            return json;
        }
        format!("{}{extra}}}", &json[..json.len() - 1])
    }
}

/// Seconds since the epoch from a DeviceTimeUpdate, if the phone sent one.
pub fn device_time(frame: &[u8]) -> Option<i64> {
    use iap2_csm::messages::device_notifications::DeviceTimeUpdate;

    if frame_msg_id(frame)? != 0x4E0B {
        return None;
    }
    DeviceTimeUpdate::decode(frame).ok()?.seconds_since_reference_date
}

pub fn to_json(frame: &[u8]) -> Option<String> {
    match frame_msg_id(frame)? {
        0x5001 => now_playing(frame),
        0xAE01 => power(frame),
        0x4158 => cellular(frame),
        0x4155 => call(frame),
        0x5201 => navigation(frame),
        _ => None,
    }
}

struct Obj {
    parts: Vec<String>,
}

impl Obj {
    fn new(kind: &str) -> Self {
        Self { parts: vec![format!("\"type\":\"{kind}\"")] }
    }
    fn str(&mut self, key: &str, value: &str) {
        self.parts.push(format!("\"{key}\":\"{}\"", escape(value)));
    }
    fn num(&mut self, key: &str, value: impl std::fmt::Display) {
        self.parts.push(format!("\"{key}\":{value}"));
    }
    fn bool(&mut self, key: &str, value: bool) {
        self.parts.push(format!("\"{key}\":{value}"));
    }
    fn finish(self) -> Option<String> {
        if self.parts.len() <= 1 {
            None
        } else {
            Some(format!("{{{}}}", self.parts.join(",")))
        }
    }
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

fn now_playing(frame: &[u8]) -> Option<String> {
    let m = NowPlayingUpdate::decode(frame).ok()?;
    let mut o = Obj::new("nowplaying");
    if let Some(mi) = m.media_item_attributes {
        if let Some(t) = mi.title {
            o.str("title", &t);
        }
        if let Some(a) = mi.artist {
            o.str("artist", &a);
        }
        if let Some(a) = mi.album {
            o.str("album", &a);
        }
        if let Some(d) = mi.duration_ms {
            o.num("durationMs", d);
        }
    }
    if let Some(pb) = m.playback_attributes {
        if let Some(s) = pb.status {
            o.num("playing", if s == PlaybackStatus::Playing { 1 } else { 0 });
        }
        if let Some(e) = pb.elapsed_ms {
            o.num("elapsedMs", e);
        }
        if let Some(n) = pb.app_name {
            o.str("appName", &n);
        }
    }
    o.finish()
}

fn power(frame: &[u8]) -> Option<String> {
    let m = PowerUpdate::decode(frame).ok()?;
    let mut o = Obj::new("power");
    if let Some(l) = m.battery_charge_level {
        o.num("level", l);
    }
    if let Some(c) = m.is_external_charger_connected {
        o.bool("charging", c);
    }
    o.finish()
}

fn cellular(frame: &[u8]) -> Option<String> {
    let m = CommunicationsUpdate::decode(frame).ok()?;
    let mut o = Obj::new("cellular");
    if let Some(s) = m.signal_strength.as_ref().and_then(|v| v.first()) {
        o.num("signal", s);
    }
    if let Some(c) = m.carrier_name {
        o.str("carrier", &c);
    }
    if let Some(s) = m.cellular_supported {
        o.bool("cellularSupported", s);
    }
    o.finish()
}

fn call(frame: &[u8]) -> Option<String> {
    let m = CallStateUpdate::decode(frame).ok()?;
    let status = m.status?;
    let phase = match status {
        0 => "ended",
        2 => "ringing",
        _ => "active",
    };
    let mut o = Obj::new("call");
    o.str("phase", phase);
    if phase != "ended" {
        if let Some(n) = m.remote_id {
            o.str("number", &n);
        }
        if let Some(n) = m.display_name {
            o.str("name", &n);
        }
    }
    o.finish()
}

fn navigation(frame: &[u8]) -> Option<String> {
    let m = RouteGuidanceUpdate::decode(frame).ok()?;
    let mut o = Obj::new("navigation");
    if let Some(s) = m.state {
        o.num("status", s);
    }
    if let Some(r) = m.current_road_name {
        o.str("roadName", &r);
    }
    if let Some(d) = m.destination_name {
        o.str("destinationName", &d);
    }
    if let Some(e) = m.eta {
        o.num("etaEpoch", e);
    }
    if let Some(t) = m.time_remaining {
        o.num("timeToDestination", t);
    }
    if let Some(d) = m.distance_remaining {
        o.num("distanceToDestination", d);
    }
    o.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use iap2_csm::messages::now_playing::{MediaItemAttributes, PlaybackAttributes};

    #[test]
    fn now_playing_json() {
        let frame = NowPlayingUpdate {
            media_item_attributes: Some(MediaItemAttributes {
                persistent_id: None,
                title: Some("Song \"A\"".into()),
                duration_ms: Some(180000),
                album: None,
                artist: Some("Artist".into()),
                album_artist: None,
                genre: None,
                artwork_ftid: None,
            }),
            playback_attributes: Some(PlaybackAttributes {
                status: Some(PlaybackStatus::Playing),
                elapsed_ms: Some(42000),
                app_name: Some("Music".into()),
                app_bundle_id: None,
            }),
        }
        .encode();
        let json = to_json(&frame).unwrap();
        assert!(json.contains("\"type\":\"nowplaying\""));
        assert!(json.contains("\"title\":\"Song \\\"A\\\"\""));
        assert!(json.contains("\"playing\":1"));
        assert!(json.contains("\"appName\":\"Music\""));
    }
}

#[cfg(test)]
mod device_tests {
    use super::*;
    use iap2_csm::messages::car_play::DeviceTransportIdentifierNotification;

    fn frame() -> Vec<u8> {
        DeviceTransportIdentifierNotification {
            bluetooth_transport_id: "0C:6A:C4:4E:F3:2A".into(),
            usb_transport_id: "usb-1".into(),
        }
        .encode()
    }

    #[test]
    fn wired_marks_usb_udid() {
        let json = device_json(&frame(), Some("00008120000924CE2E51A01E")).unwrap();
        assert!(json.contains("\"src\":\"carkit\""));
        assert!(json.contains("\"usbUdid\":\"00008120000924CE2E51A01E\""));
        assert!(json.contains("\"btMac\":\"0C:6A:C4:4E:F3:2A\""));
    }

    #[test]
    fn metadata_carries_identity_for_routing() {
        let mut tag = EventTag { cid: Some("ctrl-1".into()), ..Default::default() };
        tag.learn(&frame());
        let np = NowPlayingUpdate {
            media_item_attributes: Some(iap2_csm::messages::now_playing::MediaItemAttributes {
                persistent_id: None,
                title: Some("Song".into()),
                duration_ms: None,
                album: None,
                artist: None,
                album_artist: None,
                genre: None,
                artwork_ftid: None,
            }),
            playback_attributes: None,
        }
        .encode();
        let json = tag.apply(to_json(&np).unwrap());
        assert!(json.contains("\"phoneId\":\"0C:6A:C4:4E:F3:2A\""), "{json}");
        assert!(json.contains("\"cid\":\"ctrl-1\""), "{json}");
        assert!(json.contains("\"usbTransportId\":\"usb-1\""), "{json}");
        assert!(json.starts_with("{\"type\":\"nowplaying\""));
    }

    #[test]
    fn wireless_has_no_udid() {
        let json = device_json(&frame(), None).unwrap();
        assert!(json.contains("\"src\":\"bt\""));
        assert!(!json.contains("usbUdid"));
    }
}
