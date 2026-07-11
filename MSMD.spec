# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

block_cipher = None

# Collect data files (config and icons)
datas = [
    ('config.ini', '.'),
]

# Add icon files if they exist
for icon in ['MSMD32.png', 'refresh.png', 'settings.png']:
    if Path(icon).exists():
        datas.append((icon, '.'))

if Path('assets').exists():
    datas.append(('assets', 'assets'))

a = Analysis(
    ['MSMD_multiLevel.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'PyQt5',
        'PyQt5.QtCore',
        'PyQt5.QtGui',
        'PyQt5.QtMultimedia',
        'PyQt5.QtWidgets',
        'serial',
        'serial.tools.list_ports',
        'pyautogui',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='MSMD',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # No console window on launch
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='MSMD',
)

# macOS App Bundle
app = BUNDLE(
    coll,
    name='MSMD.app',
    icon=None,  # Set to 'MSMD.icns' if you have a macOS icon file
    bundle_identifier='com.msmd.player',
    info_plist={
        'NSPrincipalClass': 'NSApplication',
        'NSHighResolutionCapable': 'True',
        'CFBundleShortVersionString': '1.2.4',
        'CFBundleVersion': '1.2.4',
        'CFBundleName': 'MSMD Player',
        'CFBundleDisplayName': 'MSMD Player',
        'LSMinimumSystemVersion': '10.13.0',
    },
)
