# pi-mouse

![pi-mouse](assets/pi-mouse.gif)

An ASCII mouse that lives above your editor in [pi](https://pi.dev). It follows your cursor as you type, scurrying left and right with an animated tail.

## Install

```bash
pi install npm:@alasano/pi-mouse
```

## Commands

| Command                 | Description                  |
| ----------------------- | ---------------------------- |
| `/cursor-mouse`         | Toggle the mouse on or off   |
| `/cursor-mouse on\|off` | Explicitly enable or disable |

## How it works

The mouse sits on a line above the editor. When you type, it debounces your cursor position and then walks toward it step by step. It faces the direction it's moving, and its tail wiggles as it goes. When idle, the tail still sways gently.

## Requirements

- Pi interactive mode (uses the custom editor API)
