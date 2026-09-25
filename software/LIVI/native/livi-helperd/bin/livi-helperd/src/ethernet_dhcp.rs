use std::net::Ipv4Addr;
use std::process::{Command, ExitCode};

const SERVICE: &str = "livi-eth0-dhcp.service";
const SERVER: &str = "livi-usb-test";
const CLIENT: &str = "livi-eth0-client-dhcp";
const FALLBACK: &str = "livi-eth0-client-fallback";
const DEFAULT_FALLBACK: &str = "192.168.77.1/24";

fn output(program: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(program).args(args).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("{} {}: {}", program, args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn nm(args: &[&str]) -> Result<String, String> {
    output("/usr/bin/nmcli", args)
}

fn systemctl(args: &[&str]) -> Result<String, String> {
    output("/usr/bin/systemctl", args)
}

fn has_profile(name: &str) -> bool {
    nm(&["-g", "connection.id", "connection", "show", name]).is_ok()
}

fn ensure_profile(name: &str) -> Result<(), String> {
    if !has_profile(name) {
        nm(&["connection", "add", "type", "ethernet", "ifname", "eth0", "con-name", name,
            "connection.autoconnect", "no"])?;
    }
    Ok(())
}

fn validate_address(value: &str) -> Result<(), String> {
    let (address, prefix) = value.split_once('/').ok_or("Use IPv4 CIDR, for example 192.168.77.1/24")?;
    let ip: Ipv4Addr = address.parse().map_err(|_| "Invalid IPv4 address")?;
    let bits: u8 = prefix.parse().map_err(|_| "Invalid IPv4 prefix")?;
    if bits == 0 || bits > 30 || ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() || ip.is_broadcast() {
        return Err("Invalid fallback IPv4 address or prefix".into());
    }
    Ok(())
}

fn fallback_address() -> String {
    nm(&["-g", "ipv4.addresses", "connection", "show", FALLBACK])
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_FALLBACK.to_string())
}

fn ensure_client_profiles() -> Result<(), String> {
    ensure_profile(CLIENT)?;
    nm(&["connection", "modify", CLIENT, "connection.interface-name", "eth0",
        "connection.autoconnect-priority", "200", "connection.autoconnect-retries", "1",
        "ipv4.method", "auto", "ipv4.dhcp-timeout", "8", "ipv4.may-fail", "no",
        "ipv4.never-default", "yes", "ipv4.ignore-auto-dns", "yes",
        "ipv6.method", "disabled"])?;
    ensure_profile(FALLBACK)?;
    nm(&["connection", "modify", FALLBACK, "connection.interface-name", "eth0",
        "connection.autoconnect-priority", "100", "ipv4.method", "manual",
        "ipv4.addresses", &fallback_address(), "ipv4.never-default", "yes",
        "ipv6.method", "disabled"])?;
    Ok(())
}

fn service_loaded() -> bool {
    systemctl(&["show", "-p", "LoadState", "--value", SERVICE])
        .is_ok_and(|v| v == "loaded")
}

fn service_enabled() -> bool {
    Command::new("/usr/bin/systemctl").args(["is-enabled", "--quiet", SERVICE])
        .status().is_ok_and(|s| s.success())
}

fn service_active() -> bool {
    Command::new("/usr/bin/systemctl").args(["is-active", "--quiet", SERVICE])
        .status().is_ok_and(|s| s.success())
}

fn current_profile() -> String {
    nm(&["-g", "GENERAL.CONNECTION", "device", "show", "eth0"])
        .unwrap_or_default()
}

fn carrier() -> bool {
    std::fs::read_to_string("/sys/class/net/eth0/carrier")
        .is_ok_and(|v| v.trim() == "1")
}

fn activate(name: &str) {
    if carrier() {
        if let Err(error) = nm(&["--wait", "15", "connection", "up", name, "ifname", "eth0"]) {
            eprintln!("eth0 activation of {name}: {error}");
        }
    }
}

fn status() {
    println!("installed {}", service_loaded());
    println!("enabled {}", service_enabled());
    println!("active {}", service_active());
    println!("fallback {}", fallback_address());
    println!("profile {}", current_profile());
}

fn set_fallback(value: &str) -> Result<(), String> {
    validate_address(value)?;
    ensure_client_profiles()?;
    nm(&["connection", "modify", FALLBACK, "ipv4.addresses", value])?;
    if current_profile() == FALLBACK && carrier() {
        nm(&["--wait", "15", "connection", "up", FALLBACK, "ifname", "eth0"])?;
    }
    Ok(())
}

fn turn_off() -> Result<(), String> {
    ensure_client_profiles()?;
    systemctl(&["disable", "--now", SERVICE])?;
    nm(&["connection", "modify", SERVER, "connection.autoconnect", "no"])?;
    nm(&["connection", "modify", CLIENT, "connection.autoconnect", "yes"])?;
    nm(&["connection", "modify", FALLBACK, "connection.autoconnect", "yes"])?;
    // A DHCP activation failure leaves NetworkManager free to try the lower-priority fallback.
    if carrier() {
        if let Err(error) = nm(&["--wait", "15", "connection", "up", CLIENT, "ifname", "eth0"]) {
            eprintln!("eth0 DHCP activation failed; using fallback: {error}");
            nm(&["--wait", "15", "connection", "up", FALLBACK, "ifname", "eth0"])?;
        }
    }
    Ok(())
}

fn turn_on() -> Result<(), String> {
    if !has_profile(SERVER) {
        return Err(format!("Missing NetworkManager profile {SERVER}"));
    }
    if has_profile(CLIENT) {
        nm(&["connection", "modify", CLIENT, "connection.autoconnect", "no"])?;
    }
    if has_profile(FALLBACK) {
        nm(&["connection", "modify", FALLBACK, "connection.autoconnect", "no"])?;
    }
    nm(&["connection", "modify", SERVER, "connection.autoconnect", "yes"])?;
    activate(SERVER);
    systemctl(&["enable", "--now", SERVICE])?;
    Ok(())
}

pub fn run(action: Option<String>, argument: Option<String>) -> ExitCode {
    let result = match action.as_deref() {
        Some("status") => { status(); Ok(()) },
        Some("on") if service_loaded() => turn_on(),
        Some("off") if service_loaded() => turn_off(),
        Some("set-fallback") => argument.as_deref().ok_or("Missing IPv4 CIDR".to_string())
            .and_then(set_fallback),
        Some("on" | "off") => Err(format!("{SERVICE} is not installed")),
        _ => Err("usage: livi-helperd --ethernet-dhcp status|on|off|set-fallback CIDR".into()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => { eprintln!("{error}"); ExitCode::FAILURE }
    }
}
