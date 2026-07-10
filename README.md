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

Add optional WAV files to your content folder:

- `sound<N>.wav`: played when step N is completed.
- `say<N>.wav`: spoken instruction played when step N is shown.

For multi-level games, place these files in the level folder. The player falls back to the parent content folder if the file is not found in the current level folder.

## Configuration

MSMD Player stores its configuration in a platform-specific user directory:

- **macOS**: `~/Library/Application Support/MSMD/config.ini`
- **Windows**: `%APPDATA%\MSMD\config.ini`
- **Linux**: `~/.config/MSMD/config.ini`

A default configuration file is automatically created on first run.

### Changing Settings

**Option 1: Settings Dialog (Recommended)**

Click the Settings button (gear icon) in the main window to open the Settings dialog. All configuration options can be changed through the UI:
- Upgrade Trigger (Hotspot or Level)
- Upgrade Mode (Both, Left, Right, or Distance)
- Minimum Power to Move (0-255)
- Maximum Power to Move (0-255)
- Show Reference Creator checkbox

Changes are saved immediately when you click "Set".

**Option 2: Manual Edit**

You can also manually edit the `config.ini` file:

```ini
[robot]
upgradetrigger = hotspot    # Options: hotspot, level
upgrademode = both          # Options: both, left, right, distance
minpowertomove = 55         # Minimum power (0-255)
maxpowertomove = 95         # Maximum power (0-255)
showReferenceCreator = 0    # Show reference creator button (0 or 1)
```

Restart the application for manual changes to take effect.

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

## Building Standalone Applications

You can create standalone executables for macOS, Windows, and Linux that don't require Python or any dependencies to be installed. These builds use PyInstaller to bundle everything into a single application.

### Prerequisites

**All Platforms:**
- Python 3.8 or higher
- Virtual environment with all dependencies installed (see Installation section)
- PyInstaller (install with `pip install pyinstaller`)

**Platform-Specific:**
- **Windows**: No additional requirements
- **macOS/Linux**: No additional requirements

**Important**: You must build on the target platform. You cannot build a Windows .exe on macOS, or vice versa.

### Build Instructions

#### macOS

1. **Activate your virtual environment:**
   ```bash
   source venv/bin/activate
   ```

2. **Install PyInstaller:**
   ```bash
   pip install pyinstaller
   ```

3. **Build the application:**
   ```bash
   pyinstaller MSMD.spec --clean
   ```

4. **Find your application:**
   - Location: `dist/MSMD.app`
   - Size: ~92 MB
   - Double-click to run, or drag to Applications folder

5. **Distribution:**
   - Compress the .app: `cd dist && zip -r MSMD-macOS.zip MSMD.app`
   - Share the .zip file with users
   - Users may see "unidentified developer" warning on first launch (right-click → Open to bypass)

#### Windows

1. **Activate your virtual environment:**
   ```cmd
   venv\Scripts\activate
   ```

2. **Install PyInstaller:**
   ```cmd
   pip install pyinstaller
   ```

3. **Build the application:**
   ```cmd
   pyinstaller MSMD.spec --clean
   ```

4. **Find your application:**
   - Location: `dist\MSMD\MSMD.exe`
   - Size: ~100-150 MB
   - Double-click to run

5. **Distribution:**
   - Compress the entire `dist\MSMD` folder as a .zip file
   - Share with users
   - Windows Defender may flag it initially (common with PyInstaller apps)

#### Linux

1. **Activate your virtual environment:**
   ```bash
   source venv/bin/activate
   ```

2. **Install PyInstaller:**
   ```bash
   pip install pyinstaller
   ```

3. **Build the application:**
   ```bash
   pyinstaller MSMD.spec --clean
   ```

4. **Find your application:**
   - Location: `dist/MSMD/MSMD`
   - Size: ~100-150 MB
   - Run from terminal: `./dist/MSMD/MSMD`
   - Or make desktop launcher

5. **Distribution:**
   - Compress the `dist/MSMD` folder: `cd dist && tar -czf MSMD-linux.tar.gz MSMD/`
   - Share the .tar.gz file
   - Users need to extract and run: `chmod +x MSMD && ./MSMD`

### The MSMD.spec File

The `MSMD.spec` file configures the PyInstaller build process. It:
- Bundles `config.ini` and icon files (if present)
- Includes all Python dependencies
- Creates platform-appropriate executables
- On macOS, creates a proper .app bundle with Info.plist

### Build Troubleshooting

#### "Module not found" errors during build
- Ensure all dependencies are installed: `pip install -r requirements.txt`
- Try adding missing modules to `hiddenimports` in MSMD.spec

#### Large file size
- Normal for PyInstaller builds (~90-150 MB)
- Includes Python runtime + PyQt5 + all dependencies
- Use UPX compression (enabled by default in MSMD.spec)

#### Application won't launch
- **macOS**: Right-click → Open (to bypass Gatekeeper)
- **Windows**: Check Windows Defender logs, add exception if needed
- **Linux**: Ensure executable permission: `chmod +x MSMD`
- Check that `config.ini` exists in the same directory as the executable

#### "Config.ini not found" in standalone app
- Verify `config.ini` is in the project root before building
- Check the `datas` section in MSMD.spec includes config.ini

#### Missing icons
- Icons (MSMD32.png, refresh.png, settings.png) are optional
- App will work without them but buttons won't show icons
- Add PNG files to project root before building

### Code Signing (Optional)

For professional distribution:

- **macOS**: Use `codesign` and Apple Developer account
- **Windows**: Use SignTool with code signing certificate
- **Linux**: Not typically required

### Build Artifacts

After building, you'll find:
- `dist/` - Contains the final application
- `build/` - Temporary build files (can be deleted)
- `*.spec` - Build configuration (keep in repository)

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
This error should not occur as the config file is created automatically on first run. If you see this error:
- Check that the application has write permissions to the user config directory
- On macOS: `~/Library/Application Support/MSMD/`
- On Windows: `%APPDATA%\MSMD\`
- On Linux: `~/.config/MSMD/`

### "hotspots.json does not exist"
Ensure your content folder contains a valid `hotspots.json` file with entries for each image.

### Number of Images Doesn't Match Hotspots
Verify that:
- Your `hotspots.json` has an entry for each PNG image
- Image filenames are zero-padded (000000.png, 000001.png, etc.)
- The number of images matches the number of hotspot entries

### BaseStation Not Connected
This is normal if you don't have robot hardware. The application works fine without it.

## Support

For issues, questions, or contributions, please visit the project repository.
