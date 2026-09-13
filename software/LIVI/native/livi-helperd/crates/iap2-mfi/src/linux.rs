use std::thread::sleep;
use std::time::Instant;

use i2cdev::core::I2CDevice;
use i2cdev::linux::LinuxI2CDevice;

use crate::*;

pub struct I2cCoprocessor {
    dev: LinuxI2CDevice,
    addr: u16,
    protocol_major: Option<u8>,
    power: Option<PowerLine>,
}

struct PowerLine {
    req: gpiocdev::Request,
    gpio: u32,
}

// The chip only leaves a wedged state on a real power cycle
const POWER_OFF_SETTLE: Duration = Duration::from_millis(50);
const POWER_ON_SETTLE: Duration = Duration::from_millis(100);

fn power_on(gpio: i32) -> Result<Option<PowerLine>, MfiError> {
    if gpio < 0 {
        println!("[mfi] no power pin configured, expecting an externally powered chip");
        return Ok(None);
    }
    let gpio = gpio as u32;
    let req = gpiocdev::Request::builder()
        .on_chip("/dev/gpiochip0")
        .with_line(gpio)
        .as_output(gpiocdev::line::Value::Inactive)
        .request()
        .map_err(|e| MfiError::Io(format!("claim gpio {gpio}: {e}")))?;
    sleep(POWER_OFF_SETTLE);
    req.set_value(gpio, gpiocdev::line::Value::Active)
        .map_err(|e| MfiError::Io(format!("power gpio {gpio}: {e}")))?;
    sleep(POWER_ON_SETTLE);
    Ok(Some(PowerLine { req, gpio }))
}

impl Drop for PowerLine {
    fn drop(&mut self) {
        let _ = self.req.set_value(self.gpio, gpiocdev::line::Value::Inactive);
    }
}

impl PowerLine {
    pub fn gpio(&self) -> u32 {
        self.gpio
    }
}

impl I2cCoprocessor {
    pub fn open(bus: u32, power_gpio: i32) -> Result<Self, MfiError> {
        let power = power_on(power_gpio)?;
        let bus_path = format!("/dev/i2c-{bus}");
        let addr = Self::probe(&bus_path)?;
        let dev = LinuxI2CDevice::new(&bus_path, addr)
            .map_err(|e| MfiError::Io(format!("open {bus_path}@0x{addr:02X}: {e}")))?;
        let mut chip = Self { dev, addr, protocol_major: None, power };
        chip.protocol_major = chip.read_reg(REG_PROTOCOL_MAJOR, 1).ok().map(|v| v[0]);
        Ok(chip)
    }

    pub fn address(&self) -> u16 {
        self.addr
    }

    pub fn power_gpio(&self) -> Option<u32> {
        self.power.as_ref().map(PowerLine::gpio)
    }

    pub fn device_version(&mut self) -> Result<u8, MfiError> {
        Ok(self.read_reg(REG_DEVICE_VERSION, 1)?[0])
    }

    fn probe(bus_path: &str) -> Result<u16, MfiError> {
        let deadline = Instant::now() + PROBE_TIMEOUT;
        while Instant::now() < deadline {
            for cand in DEV_ADDR_CANDIDATES {
                if let Ok(mut dev) = LinuxI2CDevice::new(bus_path, cand)
                    && dev.write(&[REG_DEVICE_VERSION]).is_ok() {
                        let mut buf = [0u8; 1];
                        if dev.read(&mut buf).is_ok() {
                            return Ok(cand);
                        }
                    }
            }
            sleep(BUSY_RETRY);
        }
        Err(MfiError::NoChip { probed: DEV_ADDR_CANDIDATES.to_vec() })
    }

    fn retry(&mut self, what: &str, mut op: impl FnMut(&mut LinuxI2CDevice) -> bool) -> Result<(), MfiError> {
        let deadline = Instant::now() + IO_TIMEOUT;
        loop {
            if op(&mut self.dev) {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(MfiError::Timeout(what.to_string()));
            }
            sleep(BUSY_RETRY);
        }
    }

    fn read_reg(&mut self, reg: u8, n: usize) -> Result<Vec<u8>, MfiError> {
        self.retry(&format!("register select 0x{reg:02X}"), |dev| dev.write(&[reg]).is_ok())?;
        let mut buf = vec![0u8; n];
        self.retry(&format!("read at 0x{reg:02X}"), |dev| dev.read(&mut buf).is_ok())?;
        Ok(buf)
    }

    fn write_reg(&mut self, reg: u8, data: &[u8]) -> Result<(), MfiError> {
        let mut frame = Vec::with_capacity(data.len() + 1);
        frame.push(reg);
        frame.extend_from_slice(data);
        self.retry(&format!("write at 0x{reg:02X}"), |dev| dev.write(&frame).is_ok())
    }

    fn read_len(&mut self, reg: u8) -> Result<usize, MfiError> {
        let v = self.read_reg(reg, 2)?;
        Ok(u16::from_be_bytes([v[0], v[1]]) as usize)
    }
}

impl AuthCoprocessor for I2cCoprocessor {
    fn protocol_major(&mut self) -> Result<u8, MfiError> {
        match self.protocol_major {
            Some(v) => Ok(v),
            None => {
                let v = self.read_reg(REG_PROTOCOL_MAJOR, 1)?[0];
                self.protocol_major = Some(v);
                Ok(v)
            }
        }
    }

    fn read_certificate(&mut self) -> Result<Vec<u8>, MfiError> {
        let size = self.read_len(REG_CERT_LENGTH)?;
        self.read_reg(REG_CERT_DATA, size)
    }

    fn generate_challenge_response(&mut self, challenge: &[u8]) -> Result<Vec<u8>, MfiError> {
        let n = challenge.len();
        if !(CHALLENGE_MIN..=CHALLENGE_MAX).contains(&n) {
            return Err(MfiError::ChallengeSize(n));
        }
        self.write_reg(REG_CHALLENGE_LENGTH, &(n as u16).to_be_bytes())?;
        self.write_reg(REG_CHALLENGE_DATA, challenge)?;
        self.write_reg(REG_AUTH_CONTROL_STATUS, &[AUTH_START])?;

        sleep(Duration::from_millis(10));
        let deadline = Instant::now() + AUTH_TIMEOUT;
        loop {
            if let Ok(status) = self.read_reg(REG_AUTH_CONTROL_STATUS, 1)
                && status[0] == AUTH_DONE {
                    break;
                }
            if Instant::now() >= deadline {
                let error_code = self.read_reg(REG_ERROR_CODE, 1).ok().map(|v| v[0]);
                return Err(MfiError::AuthFailed { error_code });
            }
            sleep(AUTH_POLL);
        }

        let size = self.read_len(REG_SIGNATURE_LENGTH)?;
        self.read_reg(REG_SIGNATURE_DATA, size)
    }
}
