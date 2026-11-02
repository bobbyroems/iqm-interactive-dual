# TODO

- [ ] Fix the welcome CTA pointer remaining visible when pressed (`src/styles/app.css:3083-3086`). Pausing the animation does not let `opacity: 0` override its animated opacity, so the hand can freeze onscreen instead of hiding. Verify that pressing while the hand is visible hides it immediately.
