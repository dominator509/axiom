//! RUSTSEC-2026-0221: a stack listener must not transport non-Send tags.
//!
//! ```compile_fail
//! use event_listener::__private::StackSlot;
//! use std::rc::Rc;
//! fn needs_send<T: Send>() {}
//! needs_send::<StackSlot<'static, Rc<()>>>();
//! ```
//!
//! ```compile_fail
//! use event_listener::__private::StackSlot;
//! use std::rc::Rc;
//! fn needs_sync<T: Sync>() {}
//! needs_sync::<StackSlot<'static, Rc<()>>>();
//! ```
//!
//! The public macro must enforce the same boundary.
//! ```compile_fail
//! use event_listener::{listener, Event};
//! use std::rc::Rc;
//! let event = Event::<Rc<()>>::with_tag();
//! listener!(event => waiting);
//! std::thread::scope(|scope| {
//!     scope.spawn(move || drop(waiting));
//! });
//! ```

#[cfg(test)]
mod tests {
    use event_listener::{listener, Event, IntoNotification, Listener};
    use std::cell::Cell;
    use std::rc::Rc;

    #[test]
    fn non_send_tags_remain_usable_on_the_same_thread() {
        let event = Event::<Rc<u8>>::with_tag();
        listener!(event => waiting);
        let value = Rc::new(7);
        event.notify(1.tag(value.clone()));
        let received = waiting
            .wait_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        assert!(Rc::ptr_eq(&value, &received));
    }

    #[test]
    fn send_only_tags_remain_supported() {
        fn send_sync<T: Send + Sync>() {}
        send_sync::<event_listener::__private::StackSlot<'static, ()>>();
        // Cell is Send but not Sync: requiring Sync for the tag would regress.
        send_sync::<event_listener::__private::StackSlot<'static, Cell<u8>>>();
    }

    #[test]
    fn unit_tag_notification_crosses_threads() {
        let event = Event::new();
        listener!(event => waiting);
        std::thread::scope(|scope| {
            scope.spawn(|| event.notify(1));
            assert!(waiting
                .wait_timeout(std::time::Duration::from_secs(2))
                .is_some());
        });
    }
}
