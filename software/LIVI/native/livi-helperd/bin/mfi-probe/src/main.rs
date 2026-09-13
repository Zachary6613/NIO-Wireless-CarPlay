// Reads the MFi coprocessor's certificate and signs one challenge, printing both as hex.
// Usage: mfi-probe [--bus N] [--power-gpio N] [--no-power]

use std::process::ExitCode;

#[cfg(target_os = "linux")]
fn run() -> Result<(), Box<dyn std::error::Error>> {
    use iap2_mfi::{AuthCoprocessor, I2cCoprocessor};

    let mut bus: u32 = 2;
    let mut power_gpio: i32 = -1;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bus" => bus = args.next().and_then(|v| v.parse().ok()).unwrap_or(bus),
            "--power-gpio" => {
                power_gpio = args.next().and_then(|v| v.parse().ok()).unwrap_or(power_gpio)
            }
            "--no-power" => power_gpio = -1,
            other => return Err(format!("unknown argument: {other}").into()),
        }
    }

    println!("[mfi-probe] opening bus={bus} power_gpio={power_gpio}");
    let mut chip = I2cCoprocessor::open(bus, power_gpio)?;
    let version = chip.device_version()?;
    let major = chip.protocol_major()?;
    println!(
        "[mfi-probe] addr=0x{:02X} device_version=0x{:02X} protocol_major={} power_gpio={:?}",
        chip.address(),
        version,
        major,
        chip.power_gpio()
    );

    let cert = chip.read_certificate()?;
    println!("[mfi-probe] certificate {} bytes", cert.len());
    println!("{}", hex(&cert));

    let challenge = vec![0xAB; if major >= 3 { 32 } else { 20 }];
    println!("[mfi-probe] signing {}-byte challenge", challenge.len());
    let response = chip.generate_challenge_response(&challenge)?;
    println!("[mfi-probe] signature {} bytes", response.len());
    println!("{}", hex(&response));
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn run() -> Result<(), Box<dyn std::error::Error>> {
    Err("mfi-probe needs an i2c bus; build and run it on the Pi".into())
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("[mfi-probe] error: {e}");
            ExitCode::FAILURE
        }
    }
}
