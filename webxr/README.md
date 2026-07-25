# VR / WebXR

> Same game content, new WebXR application layer. No original source modified.

## Access

Open http://localhost:5199/webxr/index.html in a browser or PICO headset.

## PICO headset

1. Open the URL in PICO Browser
2. Click ENTER VR
3. Thumbstick left/right = character movement

## Architecture

Original game (DOM + Three.js + React rhythm) runs unchanged.
A WebGL patch enables preserveDrawingBuffer for canvas capture.
Each frame, the game is composited onto a canvas and displayed
on a VR virtual screen via Three.js WebXR.
VR controller thumbstick maps to keyboard left/right events.

## Files

- webxr/index.html - VR entry (game DOM + WebGL patch + scripts)
- webxr/vr-bootstrap.ts - VR scene, capture, controller input
