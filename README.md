# Monkey Mayhem (VR)

A Gorilla Tag-style WebXR game for the Meta Quest Browser (Quest 2/3).

**Play:** https://optimusgrok.github.io/monkey-mayhem-vr/ (open it in Quest Browser and tap **ENTER VR**)

- You move only with your arms: push off the ground, trees and rocks. Hold grip to grab and climb. There are no joysticks and no teleport.
- The arena is a 50 × 50 m jungle clearing with a rock wall all round. You can climb the bottom half of the wall; the top half is smooth.
- There are trees, branches, vines you can swing on, rocks, roots, a stream, a pond, branch platforms, a waterfall and two caves.
- Infection tag: lava monkeys tag others by touching them with a hand. When everyone is lava, a new round starts.
- Bananas to collect. A timed canopy obstacle course: climb the tree with the sign to the blue pad and race to the yellow pad. Your best time is saved.
- Name tags, proximity voice chat, a 10-minute day and night cycle with stars and fireflies, and birds and butterflies.
- Click the left thumbstick to show or hide the wrist panel (bananas, best time, players, mic, headset battery); tap its mic dot with your right hand to mute.
- Add it to your Quest home screen from the browser menu for a Monkey Mayhem app icon.
- Multiplayer is peer-to-peer WebRTC, with signalling over public Nostr relays (vendored Trystero). There's no server and no accounts. Everyone who opens the link joins room PUBLIC. Use `?room=CODE` or the room box for a private room.
- On a desktop without VR: drag or click to look, W A S D swings your arms, Space jumps, hold E to climb or grab a vine, and M mutes.

Everything is self-contained: three.js r170 and Trystero 0.21.8 (MIT) are vendored in `vendor/`.

Tests: `flock /workspace/.browser-test.lock node test/t.js` (serve the folder on :8765 first).
