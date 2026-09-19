//! Synthetic integration probe only; not a provider or deployed CLI binary.
use axiom_grok_input_guard::{initialize_inherited_image, read_inherited_image, IMAGE_REFERENCE};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("missing") {
        assert!(initialize_inherited_image().is_err());
        let _late = axiom_grok_input_guard::seal_image(&[0x42; 128]).unwrap();
        std::env::set_var("AXIOM_GROK_INPUT_PROTOCOL", "sealed-v1");
        assert!(initialize_inherited_image().is_err());
        assert!(read_inherited_image(IMAGE_REFERENCE).is_err());
        println!("missing capability remains denied");
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("child") {
        assert!(initialize_inherited_image().is_err());
        assert!(read_inherited_image(IMAGE_REFERENCE).is_err());
        println!("child capability unavailable");
        return;
    }
    initialize_inherited_image().unwrap();
    // Both initialization retries and a reused numeric FD must retain the
    // original capability. An arbitrary path cannot trigger a filesystem read.
    let reused = std::fs::File::open("/dev/zero").unwrap();
    initialize_inherited_image().unwrap();
    assert!(read_inherited_image("/credentials/auth.json").is_err());
    assert_eq!(
        read_inherited_image(IMAGE_REFERENCE).unwrap(),
        vec![0x42; 128]
    );
    assert!(read_inherited_image(IMAGE_REFERENCE).is_err());
    drop(reused);
    let child = std::process::Command::new("/grok")
        .arg("child")
        .output()
        .unwrap();
    assert!(child.status.success());
    assert_eq!(
        String::from_utf8(child.stdout).unwrap().trim(),
        "child capability unavailable"
    );
    println!("sealed image handoff passed");
}
