# -*- coding: utf-8 -*-
"""
Created on Fri Apr 20 18:11:20 2018

@author: Nick
"""

from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtGui import QIcon
from PyQt5.QtWidgets import (QHBoxLayout, QVBoxLayout, QGridLayout, QComboBox, QLabel, QSpinBox, QGroupBox, QPushButton, QWidget, QFrame, QSpacerItem, QSizePolicy, QCheckBox)

class QHLine(QFrame):
    def __init__(self):
        super(QHLine, self).__init__()
        self.setFrameShape(QFrame.HLine)
        self.setFrameShadow(QFrame.Sunken)

class Settings(QWidget):
    
    Closing = pyqtSignal(str)
    
    def __init__(self, SettingsIn):
        super(QWidget, self).__init__()
        
        self.__UserAbort = True
        
        #-----Widget Settings-----
        self.setWindowIcon(QIcon('MSMD32.png'))
        self.setWindowTitle('MSMD Settings')
        
        #Remove Maximize and Minimize buttons 
        self.setWindowFlags(self.windowFlags() & ~Qt.WindowMinMaxButtonsHint)
        
        #-----Widget Lists-----
        
        MasterUpgradeTriggers = ['Folder', 'Hotspot']
        MasterUpgradeMode = ['Both', 'Left', 'Right', 'Distance']
        
        TriggerIdx = [x.lower() for x in MasterUpgradeTriggers].index(SettingsIn['upgradeTrigger'])
        ModeIdx = [x.lower() for x in MasterUpgradeMode].index(SettingsIn['upgradeMode'])
        
        #-----Widgets-----
        
        UpgradeFrame = QGroupBox()
        UpgradeFrame.setTitle('Upgrades')
        
        SpeedFrame = QGroupBox()
        SpeedFrame.setTitle('Speed')
        
        self.UpgradeTrigger = QComboBox()
        self.UpgradeTrigger.setToolTip('Set robot upgrade interval to hotspots or levels')
        self.UpgradeTrigger.setFixedWidth(80)
        for Trigger in MasterUpgradeTriggers:
            self.UpgradeTrigger.addItem(Trigger)
        self.UpgradeTrigger.setCurrentIndex(TriggerIdx)
            
        self.UpgradeMode = QComboBox()
        self.UpgradeMode.setToolTip('Set robot upgrade mode')
        self.UpgradeMode.setFixedWidth(80)
        for Mode in MasterUpgradeMode:
            self.UpgradeMode.addItem(Mode)
        self.UpgradeMode.setCurrentIndex(ModeIdx)
            
        self.MinPower = QSpinBox()
        self.MinPower.setToolTip('Set minimum power for robot to start moving')
        self.MinPower.setMaximum(255)
        self.MinPower.setMinimum(0)
        self.MinPower.setSingleStep(5)
        self.MinPower.setFixedWidth(60)
        self.MinPower.setValue(int(SettingsIn['minPowerToMove']))

        self.MaxPower = QSpinBox()
        self.MaxPower.setToolTip('Set maximum power for robot to start moving')
        self.MaxPower.setMaximum(255)
        self.MaxPower.setMinimum(0)
        self.MaxPower.setSingleStep(5)
        self.MaxPower.setFixedWidth(60)
        self.MaxPower.setValue(int(SettingsIn['maxPowerToMove']))

        self.ShowReferenceCreator = QCheckBox()
        self.ShowReferenceCreator.setToolTip('Show the "Create Reference" button in the main window')
        self.ShowReferenceCreator.setChecked(int(SettingsIn.get('showReferenceCreator', '0')) == 1)

        SetButton = QPushButton()
        SetButton.setToolTip('Use the current settings')
        SetButton.setText('Set')
        SetButton.setFixedWidth(80)
        SetButton.clicked.connect(self.__Close)
        
        CancelButton = QPushButton()
        CancelButton.setToolTip('Cancel')
        CancelButton.setText('Cancel')
        CancelButton.setFixedWidth(80)
        CancelButton.clicked.connect(self.Abort)
        
        #-----Layouts-----
        
        hlayout1 = QHBoxLayout()
        hlayout2 = QHBoxLayout()
        glayout1 = QGridLayout()
        glayout2 = QGridLayout()
        vlayout3 = QVBoxLayout()
        
        glayout1.addWidget(QLabel('Upgrade Trigger'), 1, 1)
        glayout1.addWidget(self.UpgradeTrigger, 1, 3)
        glayout1.addWidget(QLabel('Upgrade Mode'), 3, 1)
        glayout1.addWidget(self.UpgradeMode, 3, 3)
        
        UpgradeFrame.setLayout(glayout1)
        
        space = QSpacerItem(1, 1, QSizePolicy.Fixed, QSizePolicy.Expanding)
        
        glayout2.addWidget(QLabel('Min Power to Move'), 1, 1)
        glayout2.addWidget(self.MinPower, 1, 3)
        glayout2.addWidget(QLabel('Max Power to Move'), 3, 1)
        glayout2.addWidget(self.MaxPower, 3, 3)
                
        SpeedFrame.setLayout(glayout2)
        
        hlayout1.addWidget(UpgradeFrame)
        hlayout1.addWidget(SpeedFrame)

        hlayoutRefCreator = QHBoxLayout()
        hlayoutRefCreator.addWidget(QLabel('Show Reference Creator:'))
        hlayoutRefCreator.addWidget(self.ShowReferenceCreator)
        hlayoutRefCreator.addStretch(1)

        hlayout2.addStretch(1)
        hlayout2.addWidget(SetButton)
        hlayout2.addWidget(CancelButton)
        
        vlayout3.addLayout(hlayout1)
        vlayout3.addLayout(hlayoutRefCreator)
        vlayout3.addStretch(1)
        vlayout3.addWidget(QHLine())
        vlayout3.addLayout(hlayout2)
        
        self.setLayout(vlayout3)
        
    def getSettings(self):
        out = {'upgradeTrigger': str(self.UpgradeTrigger.currentText()).lower(),
               'upgradeMode': str(self.UpgradeMode.currentText()).lower(),
               'minPowerToMove': str(self.MinPower.value()),
               'maxPowerToMove': str(self.MaxPower.value()),
               'showReferenceCreator': '1' if self.ShowReferenceCreator.isChecked() else '0'}
        return(out)
        
#==============================================================================
# Input Parameters: none
# Output Returns: none
#
# Description: This function closes the window and emits 'Abort' when the 'x' 
# is pressed. 
#==============================================================================        
    def closeEvent(self, event):
        if(self.__UserAbort):
            self.Closing.emit('Abort')
        event.accept()
        
#==============================================================================
# Input Parameters: none
# Output Returns: none
#
# Description: This function closes the window and sets the user abort to false
#==============================================================================
    def Abort(self):
        #Close the application
        self.__UserAbort = False
        self.Closing.emit('Abort')
        self.close()
        
#==============================================================================
# Input Parameters: none
# Output Returns: none
#
# Description: This function closes the window and sets the user abort to false
#==============================================================================
    def __Close(self):
        #Close the application
        self.__UserAbort = False
        self.Closing.emit('Closed')
        self.close()