# MSMD Player (Monkey See Monkey Do)

Version 1.2.4

An interactive educational game player that teaches computer skills through guided mouse clicks and keyboard inputs. Players follow visual hotspots and keyboard prompts displayed on screen, with optional robot hardware integration for physical feedback.

## Overview

MSMD Player is a PyQt5-based application that displays sequential images with interactive hotspots. Users learn computer interaction patterns by clicking specific locations or pressing specific keys as indicated by visual cues. The application supports multi-level gameplay, configurable robot upgrades, and audio feedback.

Originally developed for educational purposes, MSMD can be used to create interactive tutorials, training modules, or games that teach mouse/keyboard skills.

## Features

- **Interactive Hotspot Detection**: Visual indicators show where to click (mouse) or what keys to press
- **Multi-Level Support**: Organize content into multiple levels/folders
- **Keyboard & Mouse Input**: Supports left/right/middle mouse clicks and keyboard key presses with modifiers
- **Robot Integration**: Optional serial communication with robot base stations for physical feedback
- **Progressive Difficulty**: Configurable power/speed upgrades as players progress
- **Audio Playback**: Optional sound effects for each interaction
- **Reference File Creator**: Generate reference screenshots from game content
- **Configurable Settings**: Customize upgrade triggers, modes, and power levels

## Requirements

- Python 3.8 or higher
- macOS, Linux, or Windows

### Dependencies

All dependencies are listed in `requirements.txt`:

- PyQt5 >= 5.15.0
- pyserial >= 3.5
- pyautogui >= 0.9.50
- PyAudio >= 0.2.11

**Note for macOS users**: PyAudio requires PortAudio. Install via Homebrew:
```bash
brew install portaudio
```

## Installation

### 1. Clone the Repository

```bash
git clone https://git.firebugit.com/ksmith/MSMD-Player.git
cd MSMD-Player
```

### 2. Create Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

## Usage

### Running the Application

```bash
source venv/bin/activate  # On Windows: venv\Scripts\activate
python MSMD_multiLevel.py
```

### Setting Up Content

MSMD Player requires content folders with the following structure:

```
YourContentFolder/
├── 000000.png          # First image
├── 000001.png          # Second image
├── 000002.png          # Third image
├── ...
└── hotspots.json       # Hotspot definitions
```

#### Multi-Level Content Structure

For multi-level games:

```
ParentFolder/
├── Level1/
│   ├── 000000.png
│   ├── 000001.png
│   └── hotspots.json
├── Level2/
│   ├── 000000.png
│   ├── 000001.png
│   └── hotspots.json
└── Level3/
    ├── 000000.png
    ├── 000001.png
    └── hotspots.json
```

### Hotspots JSON Format

The `hotspots.json` file defines interactive elements for each image:

```json
{
  "000000": {
    "type": "mouse",
    "button": "left",
    "position": [427, 173],
    "modifiers": []
  },
  "000001": {
    "type": "key",
    "name": "x",
    "scancode": 45,
    "modifiers": []
  },
  "000002": {
    "type": "mouse",
    "button": "right",
    "position": [516, 780],
    "modifiers": ["shift"]
  }
}
```

#### Hotspot Properties

**For Mouse Clicks:**
- `type`: "mouse"
- `button`: "left", "right", or "middle"
- `position`: [x, y] coordinates
- `modifiers`: Array of modifier keys (e.g., ["shift"], ["ctrl"], ["alt"])

**For Keyboard Presses:**
- `type`: "key"
- `name`: Key name (e.g., "x", "a", "enter", "tab")
- `scancode`: Platform-specific scancode
- `modifiers`: Array of modifier keys (e.g., ["left shift"], ["left ctrl"])

### Optional Sound Files

Add sound effects by placing WAV files named `sound0.wav`, `sound1.wav`, etc., in your content folder. The number corresponds to the image number.

## Configuration

Edit `config.ini` to customize robot behavior:

```ini
[robot]
upgradetrigger = hotspot    # Options: hotspot, level
upgrademode = both          # Options: both, left, right, distance
minpowertomove = 55         # Minimum power (0-255)
maxpowertomove = 95         # Maximum power (0-255)
showReferenceCreator = 0    # Show reference creator button (0 or 1)
```

### Configuration Options

- **upgradetrigger**: When to upgrade robot power
  - `hotspot`: Upgrade after each successful interaction
  - `level`: Upgrade after completing each level

- **upgrademode**: How to distribute power upgrades
  - `both`: Both motors increase equally
  - `left`: Left motor increases faster initially
  - `right`: Right motor increases faster initially
  - `distance`: Time-based movement (adds fuel to robot "tank")

- **minpowertomove**: Starting power level (0-255)
- **maxpowertomove**: Maximum power level (0-255)
- **showReferenceCreator**: Show/hide the reference file creator button

## Robot Hardware (Optional)

MSMD Player can communicate with robot base stations via serial connection:

- Automatically detects devices at `/dev/tty.SLAB_USB*` (configurable for other platforms)
- Sends power commands to control robot movement
- Supports multiple base stations simultaneously
- Works without hardware (displays "BaseStation not connected" messages)

## Version History

- **1.2.4**: Updated to be compatible with all screen sizes
- **1.2.3**: Added multiple base station capability
- **1.2.2**: Added reference file creation tool
- **1.2.1**: Added game mode with time-based robot movement
- **1.2.0**: Added config file, robot upgrade options, and refresh port button
- **1.1.1**: Fixed left and right alt key bugs
- **1.1.0**: Added keyboard input support
- **1.0.0**: Initial release (mouse clicks only)

## Authors

- Original Author: JohnPaul
- Contributors: Nick (Settings module)

## License

See project repository for license information.

## Troubleshooting

### "Config.ini was not found"
Create a `config.ini` file in the project root using the configuration template above.

### "hotspots.json does not exist"
Ensure your content folder contains a valid `hotspots.json` file with entries for each image.

### PyAudio Installation Fails (macOS)
Install PortAudio first:
```bash
brew install portaudio
pip install PyAudio
```

### Number of Images Doesn't Match Hotspots
Verify that:
- Your `hotspots.json` has an entry for each PNG image
- Image filenames are zero-padded (000000.png, 000001.png, etc.)
- The number of images matches the number of hotspot entries

### BaseStation Not Connected
This is normal if you don't have robot hardware. The application works fine without it.

## Support

For issues, questions, or contributions, please visit the project repository.
