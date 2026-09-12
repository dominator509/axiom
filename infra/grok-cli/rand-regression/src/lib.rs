//! RUSTSEC-2026-0097: RNG reseeding must not invoke a synchronous logger.
//! Observe the callback boundary without re-entering the vulnerable RNG or
//! deliberately executing undefined behavior in the negative control.

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::sync::atomic::{AtomicUsize, Ordering};

    thread_local! { static VERSION: Cell<usize> = const { Cell::new(0) }; }
    static CALLBACKS: [AtomicUsize; 2] = [AtomicUsize::new(0), AtomicUsize::new(0)];
    struct Observer;
    impl log::Log for Observer {
        fn enabled(&self, _: &log::Metadata<'_>) -> bool {
            true
        }
        fn log(&self, record: &log::Record<'_>) {
            if record.target().starts_with("rand::") {
                CALLBACKS[VERSION.with(Cell::get)].fetch_add(1, Ordering::Relaxed);
            }
        }
        fn flush(&self) {}
    }
    static LOGGER: Observer = Observer;

    #[cfg(all(target_os = "linux", feature = "entropy-fault-injection"))]
    #[test]
    fn thread_rng_failure_exits_without_output() {
        for version in ["08", "10"] {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "tests::thread_entropy_failure_probe",
                    "--ignored",
                    "--nocapture",
                ])
                .env("AXIOM_RNG_FAILURE_PROBE", version)
                .env("RUST_BACKTRACE", "0")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
            while child.try_wait().unwrap().is_none() {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!("entropy failure probe did not terminate");
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            let output = child.wait_with_output().unwrap();
            assert_eq!(
                output.status.code(),
                Some(101),
                "rand {version} did not fail after entropy denial"
            );
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(stdout.contains("RNG_INITIALIZED"));
            assert!(!stdout.contains("RNG_OUTPUT_AFTER_FAILURE"));
            assert!(
                stderr.contains(if version == "08" {
                    "Reseeding RNG failed"
                } else {
                    "could not reseed ThreadRng"
                }),
                "unexpected child failure: {stderr}"
            );
        }
    }

    #[cfg(all(target_os = "linux", feature = "entropy-fault-injection"))]
    #[test]
    #[ignore = "invoked only by the isolated parent failure test"]
    fn thread_entropy_failure_probe() {
        use rand08::RngCore;
        use rand10::Rng;
        let version = std::env::var("AXIOM_RNG_FAILURE_PROBE").unwrap();
        assert!(version == "08" || version == "10");
        let mut rng08 = rand08::thread_rng();
        let mut rng10 = rand10::rng();
        std::hint::black_box(rng08.next_u64());
        std::hint::black_box(rng10.next_u64());
        println!("RNG_INITIALIZED");
        // Fault only this disposable test thread's getrandom syscall, after
        // initialization. EIO avoids the ENOSYS fallback-to-device behavior.
        // This is failure injection, not a production sandbox policy.
        let mut instructions = [
            libc::sock_filter {
                code: 0x20,
                jt: 0,
                jf: 0,
                k: 0,
            },
            libc::sock_filter {
                code: 0x15,
                jt: 0,
                jf: 1,
                k: libc::SYS_getrandom as u32,
            },
            libc::sock_filter {
                code: 0x06,
                jt: 0,
                jf: 0,
                k: 0x00050000 | libc::EIO as u32,
            },
            libc::sock_filter {
                code: 0x06,
                jt: 0,
                jf: 0,
                k: 0x7fff0000,
            },
        ];
        let program = libc::sock_fprog {
            len: instructions.len() as u16,
            filter: instructions.as_mut_ptr(),
        };
        // SAFETY: no_new_privs has scalar arguments; the filter array remains
        // live while the kernel copies the bounded sock_fprog synchronously.
        unsafe {
            assert_eq!(libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0), 0);
            assert_eq!(libc::prctl(libc::PR_SET_SECCOMP, 2, &program), 0);
        }
        let mut bytes = [0u8; 4096];
        for _ in 0..256 {
            if version == "08" {
                rng08.fill_bytes(&mut bytes);
            } else {
                rng10.fill_bytes(&mut bytes);
            }
        }
        println!("RNG_OUTPUT_AFTER_FAILURE");
    }

    #[test]
    fn failed_reseed_is_explicit_not_silent_continuation() {
        use rand08::{RngCore, SeedableRng};
        struct FailedEntropy;
        impl RngCore for FailedEntropy {
            fn next_u32(&mut self) -> u32 {
                panic!("unexpected infallible entropy call")
            }
            fn next_u64(&mut self) -> u64 {
                panic!("unexpected infallible entropy call")
            }
            fn fill_bytes(&mut self, _: &mut [u8]) {
                panic!("unexpected infallible entropy call")
            }
            fn try_fill_bytes(&mut self, _: &mut [u8]) -> Result<(), rand08::Error> {
                Err(rand08::Error::new(std::io::Error::other(
                    "injected entropy failure",
                )))
            }
        }
        let core = rand_chacha::ChaCha12Core::from_seed([7; 32]);
        let mut rng = rand08::rngs::adapter::ReseedingRng::new(core, 1, FailedEntropy);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            rng.fill_bytes(&mut [0u8; 4096]);
        }));
        let payload = result.expect_err("failed reseeding silently continued");
        let message = payload
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| payload.downcast_ref::<&str>().copied())
            .unwrap_or("");
        assert!(
            message.contains("Reseeding RNG failed: injected entropy failure"),
            "unexpected failure rather than the intended reseed error"
        );
    }

    fn exercise() {
        use rand08::RngCore;
        use rand10::Rng;
        let mut bytes = [0u8; 4096];
        VERSION.with(|v| v.set(0));
        let mut first = rand08::thread_rng();
        let mut cloned = first.clone();
        for _ in 0..256 {
            first.fill_bytes(&mut bytes);
            std::hint::black_box(cloned.next_u64());
        }
        for _ in 0..16_384 {
            std::hint::black_box(first.next_u64());
        }
        VERSION.with(|v| v.set(1));
        let mut second = rand10::rng();
        let mut cloned = second.clone();
        for _ in 0..256 {
            second.fill_bytes(&mut bytes);
            std::hint::black_box(cloned.next_u64());
        }
        for _ in 0..16_384 {
            std::hint::black_box(second.next_u64());
        }
        std::hint::black_box(bytes);
    }

    #[test]
    fn reseeding_scalar_fill_and_clones_never_call_logger() {
        log::set_logger(&LOGGER).unwrap();
        log::set_max_level(log::LevelFilter::Trace);
        // Confirm the observer is live, then discard only this synthetic event.
        log::trace!(target: "rand::observer_control", "observer control");
        assert_eq!(CALLBACKS[0].swap(0, Ordering::Relaxed), 1);
        exercise();
        std::thread::scope(|scope| {
            for _ in 0..3 {
                scope.spawn(exercise);
            }
        });
        let observed = CALLBACKS.each_ref().map(|c| c.load(Ordering::Relaxed));
        assert_eq!(
            observed,
            [0, 0],
            "RNG reseeding still reaches the synchronous logger"
        );
    }
}
