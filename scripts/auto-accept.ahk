; ═══════════════════════════════════════════════════════
; Auto Accept AG — AutoHotkey Script (Fallback)
; Tự động accept terminal commands trong VS Code AI chat
; ═══════════════════════════════════════════════════════
; Hotkey: F9 = Toggle On/Off
; Requires: AutoHotkey v2.0+
; ═══════════════════════════════════════════════════════

#Requires AutoHotkey v2.0
#SingleInstance Force

isRunning := false
checkInterval := 500  ; milliseconds

; ─── Tray menu ───
A_TrayTip := "Auto Accept AG"
TraySetIcon("shell32.dll", 78)

; ─── Toggle hotkey ───
F9:: {
    global isRunning
    isRunning := !isRunning
    
    if (isRunning) {
        ToolTip("✅ Auto Accept: ON", A_ScreenWidth - 200, 5)
        SetTimer(RemoveToolTip, -2000)
        SetTimer(CheckAndAccept, checkInterval)
    } else {
        ToolTip("❌ Auto Accept: OFF", A_ScreenWidth - 200, 5)
        SetTimer(RemoveToolTip, -2000)
        SetTimer(CheckAndAccept, 0) ; Stop timer
    }
}

RemoveToolTip() {
    ToolTip()
}

; ─── Main logic: find and click Accept/Continue buttons ───
CheckAndAccept() {
    ; Only work when VS Code is active
    if !WinActive("ahk_exe Code.exe") {
        return
    }
    
    ; Try to find and click common accept buttons
    ; Strategy: Use Accessibility API (UIA) or image search
    
    ; Method 1: Send keyboard shortcut for accept
    ; Many AI extensions use Enter or specific keybinding to accept
    ; This can be customized based on the specific extension
    
    ; Method 2: Use ControlClick if button is found
    try {
        ; Try to find button text patterns
        buttonTexts := ["Accept", "Continue", "Run", "Confirm", "Allow"]
        
        for text in buttonTexts {
            ; Use FindText or similar to locate the button
            ; This is a placeholder — real implementation depends on UI structure
        }
    }
}

; ─── Alternative: Send keyboard shortcut approach ───
; If the accept action has a keybinding, just send that key
#HotIf WinActive("ahk_exe Code.exe")

; Ctrl+Enter is commonly used to accept in many AI chat interfaces
; Uncomment the line below if needed:
; ^Enter::Send("{Enter}")

#HotIf
