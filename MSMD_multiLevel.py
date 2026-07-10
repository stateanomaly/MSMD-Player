# -*- coding: utf-8 -*-
"""
Created on Sat Feb 24 17:36:10 2018

@author: JohnPaul

@version: 1.2.4 - updated to be compatible with all screen sizes

Version History:
    1.2.3 - added multiple base station capability
    1.2.2 - added reference file creation tool
    1.2.1 - added game mode that changes the amount of time the robot can move instead of the robots speed
    1.2.0 - added config file. created option to upgrade robot after every hotspot or every level. Added refresh port button. Added different robot upgrade modes (selectable only in config file)
    1.1.1 - fixed left and right alt key bugs
    1.1.0 - Added keyboard input
    1.0.0 - Initial release (only includes mouse clicks)

"""

import sys
import os
import time
from pathlib import Path
from PyQt5.QtWidgets import (QApplication, QWidget, QLineEdit, QFileDialog,
QPushButton, QLabel, QHBoxLayout, QVBoxLayout, QMessageBox, QStackedLayout,
QGraphicsScene, QGraphicsView, QDesktopWidget, QGraphicsEllipseItem,
QGraphicsItem)
from PyQt5.QtGui import QIcon, QImage, QPixmap, QColor, QBrush, QPen
from PyQt5.QtCore import Qt, QRect, QUrl, pyqtSignal
from PyQt5.QtMultimedia import QSoundEffect
#this is the pyserial package (can be installed using pip)
import serial
import serial.tools.list_ports
import json
import configparser
from Settings import Settings
try:
    import pyautogui
except Exception:
    pyautogui = None

def getUserConfigDir():
    """Get the platform-specific user configuration directory."""
    if sys.platform == 'darwin':  # macOS
        config_dir = Path.home() / 'Library' / 'Application Support' / 'MSMD'
    elif sys.platform == 'win32':  # Windows
        config_dir = Path(os.environ.get('APPDATA', Path.home())) / 'MSMD'
    else:  # Linux and others
        config_dir = Path.home() / '.config' / 'MSMD'

    # Create directory if it doesn't exist
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir

def getConfigFilePath():
    """Get the full path to the config file in the user directory."""
    return getUserConfigDir() / 'config.ini'

def createDefaultConfig():
    """Create a default config.ini file if it doesn't exist."""
    config_path = getConfigFilePath()
    if not config_path.exists():
        default_config = """[robot]
upgradetrigger = hotspot
upgrademode = both
minpowertomove = 55
maxpowertomove = 95
showReferenceCreator = 0
"""
        config_path.write_text(default_config)
        print(f'Created default config at: {config_path}')
    return config_path

textToScanCodeTable = {}
def buildScanCodeTranslationTable (hotSpotDict):
    for imageName,metadata in hotSpotDict.items():
        hType = metadata.get('type','')
        if hType == "key":
            scancode = metadata.get("scancode",0)
            name = metadata.get("name",'')
            textToScanCodeTable[name] = scancode
            print('name: %s, scancode %s' % (name,scancode))
            
class GraphicsView(QGraphicsView):
    itemClickedEvent = pyqtSignal(QGraphicsItem, Qt.KeyboardModifiers, Qt.MouseButton)
    keyPressed = pyqtSignal(int, str, Qt.KeyboardModifiers)
    
    def __init__(self, parent=None):
        super(GraphicsView, self).__init__(parent)
        
    def mousePressEvent(self, event):
        scenePosition = self.mapToScene(event.pos()).toPoint()
        #print ('moserPressEvent pos %s scenePosition %s' % (event.pos(), scenePosition))
        itemClicked = self.itemAt(scenePosition)
        keyModifiers = event.modifiers()
        mouseButton = event.button()
        self.itemClickedEvent.emit(itemClicked, keyModifiers, mouseButton)
        
    def keyPressEvent(self, event):
        super(GraphicsView, self).keyPressEvent(event)
        text = event.text()
        code = event.key()
        modifiers = event.modifiers()
        try:
            if code == 16777220:
                textFromCode = 'enter'
            elif code == 16777217:
                textFromCode = 'tab'
            elif code == 16777219:
                textFromCode = 'backspace'
            elif code == 16777223:
                textFromCode = 'delete'
            elif code == 16777216:
                textFromCode = 'esc'
            elif code == 32:
                textFromCode = 'space'
            else:
                textFromCode = chr(code)
        except :
            textFromCode = text

        translatedScanCode = textToScanCodeTable.get(text.lower(),textToScanCodeTable.get(textFromCode.lower(),0))
        print('keyPressEvent text "%s" textFromCode %s scanCode %s key %s modifiers %s' % (
            text,
            textFromCode,
            translatedScanCode, 
            code, 
            self.convertModifier(modifiers)))
        
        self.keyPressed.emit(translatedScanCode, textFromCode, modifiers)
        
    def convertModifier(self, pressedModifiers):
        modifierTextList = []
        if(pressedModifiers & Qt.ShiftModifier):
            modifierTextList.append('shift')
        if(pressedModifiers & Qt.AltModifier):
            modifierTextList.append('alt')
        if(pressedModifiers & Qt.ControlModifier):
            if sys.platform == 'darwin':  # macOS
                modifierTextList.append('cmd')  # on the mac this is the command key
            else:  # Linux and Windows
                modifierTextList.append('ctrl')
        if(pressedModifiers & Qt.MetaModifier):
            if sys.platform == 'darwin':  # macOS
                modifierTextList.append('ctrl')  # on the mac this is the control key
            else:  # Linux and Windows
                modifierTextList.append('win')

        return modifierTextList
    
        
class App(QWidget):
    cleanupEvent = pyqtSignal()
    
    def __init__(self):
        super().__init__()
        self.versionNumber = '1.2.4'
        self.title = 'Monkey See Monkey Do   v'+self.versionNumber
        self.left = 10
        self.top = 80
        self.width = 640
        self.height = 100
        self.folderName = ''
        self.imageList = []
        self.scaledPixmapList = []
        self.numImages = 0
        self.currentImageNumber = 0
        self.currentTotalImageNumber = 0
        self.hotSpotFilename = 'hotspots.json'
        self.hotSpotFile = None
        self.hotSpotSize = 50
        self.currentHotSpot = None
        self.startTime = None
        self.endTime = None
        self.completionSound = QSoundEffect(self)
        self.narrationSound = QSoundEffect(self)
        self.screen = QDesktopWidget().availableGeometry()
        print(self.screen)
        print('width', self.screen.width(), 'height', self.screen.height())
        self.initUI()
        
 
    def initUI(self):
        
        self.readConfig()
        
        self.portLabel = QLabel('Port(s): ', self)
        self.portDisplay = QLineEdit(self)
        self.portDisplay.setEnabled(False)
        self.portRefreshButton = QPushButton(self)
        self.portRefreshButton.setToolTip('Press to detect port of connected base station')
        self.portRefreshButton.clicked.connect(self.refreshPorts)
        if os.path.exists('refresh.png'):
            self.portRefreshButton.setIcon(QIcon('refresh.png'))
            self.portRefreshButton.setFixedWidth(24)
        else:
            self.portRefreshButton.setText('⟳')
            self.portRefreshButton.setFixedWidth(30)

        self.settingsButton = QPushButton()
        self.settingsButton.setToolTip('Open the Settings Dialog')
        self.settingsButton.clicked.connect(self.openSettings)
        if os.path.exists('settings.png'):
            self.settingsButton.setIcon(QIcon('settings.png'))
            self.settingsButton.setMaximumWidth(24)
        else:
            self.settingsButton.setText('⚙')
            self.settingsButton.setMaximumWidth(30)
        
        self.connected = False
        self.refreshPorts()
        if self.showReferenceCreator:
            self.referenceCreator = QPushButton('Create Reference', self)
            self.referenceCreator.setToolTip('Create a reference file from the selected image set')
            self.referenceCreator.clicked.connect(self.createReferenceFile)
            self.referenceCreator.setEnabled(False)
        
        self.folderButton = QPushButton('Select Folder', self)
        self.folderButton.setToolTip('Select the folder that contains the content you would like to play')
        self.folderButton.clicked.connect(self.folderButtonClicked)
        
        self.folderLabel = QLabel('Selected Folder:', self)
    
        self.selectedFolder = QLineEdit(self)
        self.selectedFolder.setEnabled(False)
        
        self.numLevelsLabel = QLabel('Number of Levels:', self)
        self.numLevelsDisplay = QLineEdit(self)
        self.numLevelsDisplay.setEnabled(False)
        
        self.numImagesLabel = QLabel('Number of Images:', self)
        self.numImagesDisplay = QLineEdit(self)
        self.numImagesDisplay.setEnabled(False)
        
        self.startLabel = QLabel('Press "Start" to begin game', self)
        
        self.startButton = QPushButton('Start', self)
        self.startButton.setToolTip('Start Game')
        self.startButton.clicked.connect(self.startButtonClicked)
        self.startButton.setEnabled(False)
        
        self.hboxPort = QHBoxLayout()
        self.hboxPort.addWidget(self.portLabel)
        self.hboxPort.addWidget(self.portDisplay)
        self.hboxPort.addWidget(self.portRefreshButton)
        self.hboxPort.addWidget(self.settingsButton)

        self.hbox = QHBoxLayout()
        self.hbox.addWidget(self.folderLabel)
        self.hbox.addWidget(self.selectedFolder)
        
        self.hboxNumLevels = QHBoxLayout()
        self.hboxNumLevels.addWidget(self.numLevelsLabel)
        self.hboxNumLevels.addWidget(self.numLevelsDisplay)
        
        self.hboxNumImages = QHBoxLayout()
        self.hboxNumImages.addWidget(self.numImagesLabel)
        self.hboxNumImages.addWidget(self.numImagesDisplay)
        
        self.vbox = QVBoxLayout()
        self.vbox.addLayout(self.hboxPort)
        self.vbox.addWidget(self.folderButton)
        self.vbox.addLayout(self.hbox)
        self.vbox.addLayout(self.hboxNumLevels)
        self.vbox.addLayout(self.hboxNumImages)
        if self.showReferenceCreator:
            self.vbox.addWidget(self.referenceCreator)
        self.vbox.addWidget(self.startLabel)
        self.vbox.addWidget(self.startButton)
        self.vbox.addStretch(4)
        
        self.startPage = QWidget()
        self.startPage.setLayout(self.vbox)
        
        self.scene = QGraphicsScene()
        self.graphicsView = GraphicsView(self.scene)
        self.graphicsView.itemClickedEvent.connect(self.hotSpotClickedHandler)
        self.graphicsView.keyPressed.connect(self.keyPressedHandler)
        
        self.graphicsLayout = QVBoxLayout()
        self.graphicsLayout.addWidget(self.graphicsView)
        self.graphicsLayout.setContentsMargins(0,0,0,0)
        
        self.gamePage = QWidget()
        self.gamePage.setLayout(self.graphicsLayout)
        
        self.stackedLayout = QStackedLayout()
        self.stackedLayout.addWidget(self.startPage)
        self.stackedLayout.addWidget(self.gamePage)
        self.stackedLayout.setCurrentIndex(0)
        
        self.setLayout(self.stackedLayout)
        self.setWindowTitle(self.title)
        self.setGeometry(self.left, self.top, self.width, self.height)
        if os.path.exists('MSMD32.png'):
            self.setWindowIcon(QIcon('MSMD32.png'))
        self.cleanupEvent.connect(self.cleanupStuff)
        self.show()
        self.bringToFront()
        
        
    def readConfig(self):
        # Create default config if it doesn't exist
        config_path = createDefaultConfig()
        self.configFilePath = str(config_path)

        self.config = configparser.ConfigParser()
        fileCheck = self.config.read(self.configFilePath)
        if(fileCheck == []):
            QMessageBox.critical(self, 'Config Error!', f'config.ini was not found at {self.configFilePath}', QMessageBox.Ok)
        self.robotSettings = self.config['robot']
        self.upgradeTrigger = self.robotSettings['upgradeTrigger']
        self.upgradeMode = self.robotSettings['upgradeMode']
        self.minPowerToMove = self.robotSettings['minPowerToMove']
        self.maxPowerToMove = self.robotSettings['maxPowerToMove']
        self.showReferenceCreator = int(self.robotSettings.get('showReferenceCreator', '0'))
        
    def writeConfig(self):
        self.robotSettings['upgradeTrigger'] = self.upgradeTrigger
        self.robotSettings['upgradeMode'] = self.upgradeMode
        self.robotSettings['minPowerToMove'] = self.minPowerToMove
        self.robotSettings['maxPowerToMove'] = self.maxPowerToMove
        self.robotSettings['showReferenceCreator'] = str(self.showReferenceCreator)
        with open(self.configFilePath, 'w') as configFile:
            self.config.write(configFile)
    
    def openSettings(self):
        try: 
            self.settingsWindow = Settings(self.robotSettings)
            self.settingsWindow.Closing.connect(self.settingsClosed)
            self.settingsWindow.show()
            self.setDisabled(True)
        except:
            print ('ERROR - Setting.py Load Failed!')
        
    def settingsClosed(self, message):
        if(message == 'Abort'):
            print ('Settigns Aborted!')
        elif(message == 'Closed'):
            print ('Settings Closed!')
            #Set New Settings
            newSettings = self.settingsWindow.getSettings()
            self.upgradeTrigger = newSettings['upgradeTrigger']
            self.upgradeMode = newSettings['upgradeMode']
            self.minPowerToMove = newSettings['minPowerToMove']
            self.maxPowerToMove = newSettings['maxPowerToMove']
            self.showReferenceCreator = int(newSettings['showReferenceCreator'])
            self.writeConfig()
            # Update reference creator button visibility if it exists
            if hasattr(self, 'referenceCreator'):
                self.referenceCreator.setVisible(self.showReferenceCreator == 1)
        else:
            print ('ERROR - Unknown message returned from Settings.py Window!')
        self.setDisabled(False)
        
    def bringToFront(self):
        self.setWindowState(self.windowState() & ~Qt.WindowMinimized | Qt.WindowActive)
        self.activateWindow()
        
    def refreshPorts(self):
        if(self.connected):
            for baseStation in self.robot:
                baseStation.close()
        comPorts = self.findPorts()
        if(comPorts):
            self.robot = []
            self.portDisplayText = ''
            for port in comPorts:
                try:
                    baseStation = serial.Serial(port)
                except (serial.SerialException, OSError):
                    continue
                baseStation.baudrate = 115200
                baseStation.timeout = 0.05
                self.robot.append(baseStation)
                self.portDisplayText += (port + '  ')
                
            self.portDisplay.setText(self.portDisplayText)
            self.connected = len(self.robot) > 0
        else:
            self.robot = []
            self.portDisplay.setText('')
            self.connected = False
        
    def folderButtonClicked(self):
        self.folderName = QFileDialog.getExistingDirectory(self, "Select Folder Location for Recorded Content")
        print(self.folderName)
        if self.folderName == '':
            return
        if os.path.isdir(self.folderName):
            self.numLevels = 0
            self.numTotalImages = 0
            self.listOfFilesInSelectedFolder = os.listdir(self.folderName)
            self.folderList = []
            self.folderListNameOnly = []
            for name in self.listOfFilesInSelectedFolder:
                fullFileName = os.path.join(self.folderName, name)
                if os.path.isdir(fullFileName):
                    result = self.countLevel(fullFileName)
                    if(result<0):
                        return
                    self.folderList.append(fullFileName)
                    self.folderListNameOnly.append(name)
                    self.numLevels += 1
                    self.numTotalImages += result

            if(self.numLevels>0):
                #multiLevel game selected
                result = self.loadLevel(self.folderList[0])
                if(result<0):
                    return
                self.numLevelsDisplay.setText(str(self.numLevels))
            else:
                result = self.loadLevel(self.folderName)
                if(result<0):
                    return
                self.numTotalImages = result
                self.numLevelsDisplay.setText('1')
            
            self.currentLevel = 0
            self.numImagesDisplay.setText(str(self.numTotalImages))
            self.startButton.setEnabled(True)
            if self.showReferenceCreator:
                self.referenceCreator.setEnabled(True)
            self.selectedFolder.setText(self.folderName)
        else:
            QMessageBox.warning(self, 'Folder Error!', 'The folder does not exist!\nPlease select a valid folder', QMessageBox.Ok)

    def countLevel(self, levelToLoad):
        try:
            print('Trying to count '+levelToLoad)
            print('%s' % levelToLoad+os.path.sep+self.hotSpotFilename)
            with open(levelToLoad+os.path.sep+self.hotSpotFilename, 'r') as hotSpotFile:
                hotSpotDict = json.load(hotSpotFile)
            numHotSpotRecords = len(hotSpotDict)
        except IOError:
            QMessageBox.critical(self, 'Error: No hotspots.json', 'hotspots.json does not exist\nA Hot Spot file is required to play the game. Please select a complete and valid content folder', QMessageBox.Ok)
            self.selectedFolder.setText('Error: No hotspots.json')
            return -1
        try:
            numImages = len([imfile for imfile in os.listdir(levelToLoad) if imfile.endswith('.png')])-1
        except IOError:
            QMessageBox.critical(self, 'Error: images reading', 'Images could not be read\nPlease select a complete and valid content folder', QMessageBox.Ok)
            return -1
        if(numImages != numHotSpotRecords):
            QMessageBox.critical(self, 'Image Count Error', 'Error: number of images in level "'+str(levelToLoad)+'" do not match the number of hot spot records', QMessageBox.Ok)
            return -1
        return numImages

    def loadLevel(self, levelToLoad):
        try:
            print('Trying to load '+levelToLoad)
            print('%s' % levelToLoad+os.path.sep+self.hotSpotFilename)
            self.hotSpotFile = open(levelToLoad+os.path.sep+self.hotSpotFilename, 'r')
            self.hotSpotDict = json.load(self.hotSpotFile)
            self.numHotSpotRecords = len(self.hotSpotDict)
            #self.hotSpotCsv = csv.reader(self.hotSpotFile)
            #next(self.hotSpotCsv)
            #self.numHotSpotRecords = sum(1 for row in self.hotSpotCsv)
            #self.hotSpotFile.seek(0)
            #next(self.hotSpotCsv) #skip column labels on first line
            self.hotSpotFile.close()
            buildScanCodeTranslationTable(self.hotSpotDict)
        except IOError:
            QMessageBox.critical(self, 'Error: No hotspots.json', 'hotspots.json does not exist\nA Hot Spot file is required to play the game. Please select a complete and valid content folder', QMessageBox.Ok)
            self.selectedFolder.setText('Error: No hotspots.json')
            return -1
        self.imageList = []
        try:
            for imageFile in sorted((imfile for imfile in os.listdir(levelToLoad) if imfile.endswith('.png'))):
            
                self.imageList.append(QImage(levelToLoad+os.path.sep+imageFile))

        except IOError:
            QMessageBox.critical(self, 'Error: images reading', 'Images could not be read\nPlease select a complete and valid content folder', QMessageBox.Ok)
            return -1
        self.scaledPixmapList = [
            QPixmap.fromImage(image).copy(QRect(0,0,1920,1020)).scaled(self.screen.width(), self.screen.height(), aspectRatioMode=Qt.IgnoreAspectRatio)
            for image in self.imageList
        ]
        self.numImages = len(self.imageList)-1
        if(self.numImages != self.numHotSpotRecords):
            QMessageBox.critical(self, 'Image Count Error', 'Error: number of images in level "'+str(levelToLoad)+'" do not match the number of hot spot records', QMessageBox.Ok)
            return -1
        return self.numImages

    def startButtonClicked(self):
        print('start')
        self.stackedLayout.setCurrentIndex(1)
        self.paintImageIndex(0)
        self.showMaximized()
        
        if(self.upgradeTrigger == 'level'):
            self.setPower((int(self.minPowerToMove)*100)//255)
        
        self.startTime = time.time()
        
    def paintImageIndex(self, imageNumber):
        powerLevel = None
        if(self.upgradeTrigger == 'hotspot'):
            powerLevel = (self.currentTotalImageNumber/max(self.numTotalImages-1, 1))*100
            print('power:', powerLevel, '  currentTotalImageNum:', self.currentTotalImageNumber, '  numTotalImages:', self.numTotalImages)

        self.scene.clear()
        print('current image number:', imageNumber)
        self.nextHotSpotInput = self.hotSpotDict[str(self.currentImageNumber).zfill(6)]
        print('nextHotSpotInput', self.nextHotSpotInput)
        self.currentPixmap = self.scaledPixmapList[imageNumber]
        
        self.scene.addPixmap(self.currentPixmap)
        
        self.currentInputModifiers = self.simplifyModifierList(self.nextHotSpotInput['modifiers'])
        
        if(self.nextHotSpotInput['type'] == 'mouse'):
            commandString = ''
            if self.currentInputModifiers != []:
                commandString += 'Press '
            for mod in self.currentInputModifiers:
                commandString += mod + ' + '
            commandString += 'Click '
            self.currentMouseButton = self.nextHotSpotInput['button']
            if(self.currentMouseButton == 'right'):
                pen = QPen(QColor(0,0,255,128))
                commandString += 'right mouse button'
            elif(self.currentMouseButton == 'left'):
                pen = QPen(QColor(255,0,0,128))
                commandString += 'left mouse button'
            elif(self.currentMouseButton == 'middle'):
                pen = QPen(QColor(0,255,0,128))
                commandString += 'scroll wheel (middle mouse button)'
            else:
                pen = QPen(QColor(0,0,0,128))
            xScale = self.screen.width()/1920
            yScale = self.screen.height()/1020
            if(xScale>yScale):
                minScale = yScale
            else:
                minScale = xScale
            scaledHotSpotSize = self.hotSpotSize*minScale
            xPosition = self.nextHotSpotInput['position'][0]*xScale
            yPosition = self.nextHotSpotInput['position'][1]*yScale
            print('next hotspot pos x %s y %s' %(xPosition,yPosition))
            brush = QBrush(QColor(180, 180, 180, 100))
            self.currentHotSpot = QGraphicsEllipseItem()
            self.currentHotSpot.setRect(xPosition-scaledHotSpotSize/2, yPosition-scaledHotSpotSize/2, scaledHotSpotSize, scaledHotSpotSize)
            self.currentHotSpot.setBrush(brush)
            self.currentHotSpot.setPen(pen)
            self.scene.addItem(self.currentHotSpot)
            self.currentInputKey = -1
        elif(self.nextHotSpotInput['type'] == 'key'):
            #print('key')
            self.currentInputKey = self.nextHotSpotInput['scancode']
            commandString = 'Press '
            for mod in self.currentInputModifiers:
                commandString += mod
                commandString += ' + '
            commandString += self.nextHotSpotInput['name']
            self.currentHotSpot = 'not a hotspot'
        else:
            QMessageBox.critical(self, 'Hotspot Type Error', 'Error: hotSpotInput type is incorrect. got: "'+self.nextHotSpotInput['type']+'"  expected: "key" or "mouse"', QMessageBox.Ok)

            commandString = ''

        self.setWindowTitle(self.title + '       ' + commandString)
        if powerLevel is not None:
            self.setPower(powerLevel)

        self.narrationSound.stop()
        soundFilename = self.resolveSoundFile('say%s.wav' % self.currentImageNumber)
        if soundFilename is not None:
            self.narrationSound.setSource(QUrl.fromLocalFile(soundFilename))
            self.narrationSound.play()

    def currentLevelFolder(self):
        if self.numLevels > 0:
            return self.folderList[self.currentLevel]
        return self.folderName

    def resolveSoundFile(self, soundFilename):
        levelSoundFilename = os.path.join(self.currentLevelFolder(), soundFilename)
        if os.path.isfile(levelSoundFilename):
            return levelSoundFilename
        fallbackSoundFilename = os.path.join(self.folderName, soundFilename)
        if os.path.isfile(fallbackSoundFilename):
            return fallbackSoundFilename
        return None

    def playSound(self):
        soundFilename = self.resolveSoundFile('sound%s.wav' % self.currentImageNumber)
        if soundFilename is None:
            return
        self.completionSound.setSource(QUrl.fromLocalFile(soundFilename))
        self.completionSound.play()
        
    def hotSpotClickedHandler(self, itemClicked, modifiers, mouseButton):
                                                    
        print('itemClicked %s, self.currentHotSpot %s, mouseButton %s' % (itemClicked, self.currentHotSpot, mouseButton))
        
        if itemClicked is self.currentHotSpot:
            if self.checkModifierMatch(modifiers):
                if self.checkButtonMatch(mouseButton):
                    #print('clicked on hot spot!')
                    
                    self.playSound()
                    
                    self.currentImageNumber += 1
                    self.currentTotalImageNumber += 1
                    if self.currentImageNumber >= self.numImages:
                        self.levelCompleted()
                    else:
                        self.paintImageIndex(self.currentImageNumber)
                else:
                    #print('wrong mouse button clicked')
                    pass
            else:
                #print("modifiers don't match")
                pass
        else:
            #print('wrong spot clicked')
            pass
    
    def checkButtonMatch(self, pressedMouseButton):
        if pressedMouseButton == Qt.LeftButton:
            pressedMouseButtonString = 'left'
        elif pressedMouseButton == Qt.RightButton:
            pressedMouseButtonString = 'right'
        elif pressedMouseButton == Qt.MiddleButton:
            pressedMouseButtonString = 'middle'
        else:
            return False
        
        return self.currentMouseButton == pressedMouseButtonString
        
    
    def keyPressedHandler(self, nativeScanCode, keyText, modifiers):
        print('scanCode %s, currentInputKey %s' % (nativeScanCode, self.currentInputKey))
        if (nativeScanCode == self.currentInputKey) and self.checkModifierMatch(modifiers):
            #print('pressed correct key (or key combination)')
           
            self.playSound()
            
            self.currentImageNumber += 1
            self.currentTotalImageNumber += 1
            if self.currentImageNumber >= self.numImages:
                self.levelCompleted()
            else:
                self.paintImageIndex(self.currentImageNumber)
        else:
            #print('wrong key or key combination pressed')
            pass
            
    def checkModifierMatch(self, pressedModifiers):
        modifierTextList = []
        if(pressedModifiers & Qt.ShiftModifier):
            modifierTextList.append('shift')
        if(pressedModifiers & Qt.AltModifier):
            modifierTextList.append('alt')
        if(pressedModifiers & Qt.ControlModifier):
            if sys.platform == 'darwin':  # macOS
                modifierTextList.append('cmd')  # on the mac this is the command key
            else:  # Linux and Windows
                modifierTextList.append('ctrl')
        if(pressedModifiers & Qt.MetaModifier):
            if sys.platform == 'darwin':  # macOS
                modifierTextList.append('ctrl')  # on the mac this is the control key
            else:  # Linux and Windows
                modifierTextList.append('win')
        return set(modifierTextList) == set(self.currentInputModifiers)
    
    def simplifyModifierList(self, modifierList):
        tempSet = set()
        for item in modifierList:
            if item == 'left shift':
                tempSet.add('shift')
            elif item == 'right shift':
                tempSet.add('shift')
            elif item == 'left ctrl':
                tempSet.add('ctrl')
            elif item == 'right ctrl':
                tempSet.add('ctrl')
            elif item == 'left alt':
                tempSet.add('alt')
            elif item == 'right alt':
                tempSet.add('alt')
            else:
                tempSet.add(item)
        return list(tempSet)
    
    def levelCompleted(self):
        print('completed level: ', self.currentLevel+1)
        if(self.upgradeTrigger == 'level'):
            powerLevel = (self.currentLevel/max(self.numLevels-1, 1))*100
            self.setPower(powerLevel)

        self.currentLevel += 1
        if(self.currentLevel>=self.numLevels):
            self.gameCompleted()
        else:
            self.currentImageNumber = 0
            if self.loadLevel(self.folderList[self.currentLevel]) < 0:
                self.stackedLayout.setCurrentIndex(0)
                self.showNormal()
                return
            self.paintImageIndex(0)
    
    def gameCompleted(self):
        self.endTime = time.time()
        self.narrationSound.stop()
        self.scene.clear()
        self.currentHotSpot = None
        self.currentImageNumber = 0
        self.currentTotalImageNumber = 0
        self.currentPixmap = None
        self.currentPixmap = self.scaledPixmapList[self.numImages]
        self.scene.addPixmap(self.currentPixmap)
        buttonReply = QMessageBox.information(self, 'You Win!', 'Congradulations, You Won!\nYou completed the game in ' + "%.2f" % (self.endTime-self.startTime) + ' seconds', QMessageBox.Ok | QMessageBox.Close)
        if buttonReply == QMessageBox.Ok:
            self.stackedLayout.setCurrentIndex(0)
            self.showNormal()
            if(self.numLevels>0):
                self.loadLevel(self.folderList[0])
            else:
                self.loadLevel(self.folderName)
            self.currentLevel = 0
    
    def findPorts(self):
        comPortsList = []
        matchTerms = ('SLAB', 'Silicon Labs', 'CP210')
        for port in serial.tools.list_ports.comports():
            description = port.description or ''
            hwid = port.hwid or ''
            portText = (description + ' ' + hwid).lower()
            if any(term.lower() in portText for term in matchTerms):
                comPortsList.append(port.device)
        return comPortsList
    
    def setPower(self, powerLevel):
        if(powerLevel>100):
            raise ValueError('powerLevel cannot be set above 100')
        if(powerLevel<0):
            raise ValueError('powerLevel cannot be set below 0')
        
        minPower = int(self.minPowerToMove)
        mode = self.upgradeMode
        leftPower = minPower
        rightPower = minPower
        maxPower = int(self.maxPowerToMove)
        if(mode == "left"):
            if(powerLevel<=50):
                leftPower = self.interpolate( powerLevel, 0, 100, minPower, maxPower)
                rightPower = self.interpolate(powerLevel, 0,  50, minPower, maxPower)
            else:
                leftPower = self.interpolate(powerLevel,  0, 100, minPower, maxPower)
                rightPower = self.interpolate(powerLevel,50, 100, minPower, maxPower)
        elif(mode == "right"):
            if(powerLevel<=50):
                rightPower = self.interpolate(powerLevel,  0,100, minPower, maxPower)
                leftPower = self.interpolate(powerLevel,   0, 50, minPower, maxPower)
            else:
                rightPower = self.interpolate(powerLevel,  0,100, minPower, maxPower)
                leftPower = self.interpolate(powerLevel,  50,100, minPower, maxPower)
        elif(mode == "both"):
            leftPower = self.interpolate(powerLevel,       0,100, minPower, maxPower)
            rightPower = leftPower
        elif(mode == "distance"):
            #add fuel to the robot "tank"
            pass
        else:
            raise ValueError('upgradeMode in config.ini does not match any accepted value')
        
        iLP = int(leftPower)
        iRP = int(rightPower)

        #desiredPowerLevel -= 45
        if self.robot:
            print('\nconnected to BaseStation, attempting to set power to', powerLevel, '   L:', leftPower, 'R:', rightPower,'\n')
            for baseStation in self.robot:
                baseStation.write(bytes([0,0,iLP,iRP])+b'\n')
                baseStation.write(bytes([0,0,iLP,iRP])+b'\n')
        else:
            print('BaseStation not connected, cannot change power level')
    
    def interpolate(self, inputValue, inputMin, inputMax, outputMin, outputMax):
        ratio = (inputValue - inputMin)/(inputMax - inputMin)
        outputValue = (outputMax - outputMin) * ratio + outputMin
        return outputValue
    
    def closeEvent(self, event):
        print('emitting cleanup event')
        try:
            self.settingsWindow.Abort()
        except:
            print('ERROR - Could not properly close settings window!')
        self.cleanupEvent.emit()
    
    def cleanupStuff(self):
        if self.robot:
            for baseStation in self.robot:
                baseStation.close()
        print('closing')
        
    def createReferenceFile(self):
        if pyautogui is None:
            QMessageBox.warning(self, 'Reference Creator Unavailable', 'pyautogui is required to create reference files.', QMessageBox.Ok)
            return
        referenceFolder = QFileDialog.getExistingDirectory(self, "Select Folder Location for Reference")
        self.startTime = time.time()
        if os.path.isdir(referenceFolder):
            
            if(self.numLevels>0):
                #multiLevel game selected
                print('multiLevelGame Reference started')
                for i in range(0,self.numLevels):
                    #create folder to hold level in reference file
                    levelFolderName = referenceFolder+os.path.sep+self.folderListNameOnly[i]
                    os.mkdir(levelFolderName)
                    
                    self.loadLevel(self.folderList[i])
                    
                    #start msmd level
                    self.stackedLayout.setCurrentIndex(1)
                    self.showMaximized()
                    time.sleep(0.2)
                    
                    for j in range(0, self.numImages):
                        print('next image: '+str(j))
                        self.paintImageIndex(j)
                        QApplication.processEvents()
                        
                        time.sleep(0.05)
                        imageName = str(self.currentImageNumber).zfill(6)
                        pyautogui.screenshot(levelFolderName+os.path.sep+imageName+'.png')
                        
                        self.currentImageNumber += 1
                        self.currentTotalImageNumber += 1
                    
                    self.currentImageNumber = 0
            else:
                print('singleLevelGame Reference Started')
                self.loadLevel(self.folderName)
                self.stackedLayout.setCurrentIndex(1)
                self.showMaximized()
                
                for j in range(0, self.numImages):
                    print('next image: '+str(j))
                    self.paintImageIndex(j)
                    QApplication.processEvents()
                    
                    time.sleep(0.05)
                    imageName = str(self.currentImageNumber).zfill(6)
                    pyautogui.screenshot(referenceFolder+os.path.sep+imageName+'.png')
                    
                    self.currentImageNumber += 1
                    self.currentTotalImageNumber += 1
                    
                self.currentImageNumber = 0
            
            self.gameCompleted()
            
                
            
            
        
if __name__ == '__main__':
    app = 0
    app = QApplication(sys.argv)
    ex = App()
    sys.exit(app.exec_())
