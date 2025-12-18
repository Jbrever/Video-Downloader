# Design Document

## Overview

This design implements UI state management improvements for the video download application to provide better user feedback and enable seamless multiple downloads. The solution focuses on proper state transitions and download detection mechanisms.

## Architecture

The implementation uses a client-side state management approach with event-driven UI updates. The core architecture involves:

1. **State Machine Pattern**: Enhanced UI state management with clear transitions
2. **Download Detection**: Browser-based download event monitoring
3. **Message Queue System**: Proper sequencing of status message updates

## Components and Interfaces

### Enhanced UI State Manager

```javascript
// Enhanced state management with download detection
const UIStateManager = {
  currentState: 'idle',
  
  // State transition methods
  setState(newState, options = {}) {
    // Handle state transitions with proper cleanup
  },
  
  // Download detection
  detectDownloadStart() {
    // Monitor for download initiation
  },
  
  // Message management
  updateStatusMessage(type, title, message, persistent = false) {
    // Control message visibility and persistence
  }
}
```

### Download Event Detection System

The system will implement multiple detection strategies:

1. **URL Navigation Detection**: Monitor `window.location.href` changes for download URLs
2. **Hidden Iframe Method**: Track iframe load events for download triggers
3. **Response Header Analysis**: Detect `Content-Disposition: attachment` headers

### Status Message Controller

```javascript
const StatusController = {
  // Message types with auto-hide behavior
  messageTypes: {
    'searching': { autoHide: true, hideOnSuccess: true },
    'processing': { autoHide: true, hideOnDownload: true },
    'success': { autoHide: false, persistent: true },
    'error': { autoHide: false, persistent: true }
  },
  
  showMessage(type, title, message) {
    // Display message with appropriate behavior
  },
  
  hideMessage(type) {
    // Hide specific message type
  },
  
  clearTransientMessages() {
    // Remove non-persistent messages
  }
}
```

## Data Models

### UI State Model

```javascript
const UIState = {
  currentPhase: 'idle', // idle, searching, found, processing, downloading, complete
  messages: {
    searching: { visible: false, title: '', content: '' },
    processing: { visible: false, title: '', content: '' },
    status: { visible: false, title: '', content: '', type: '' }
  },
  button: {
    enabled: true,
    text: 'Download Video'
  },
  downloadInProgress: false,
  lastSearchResults: null
}
```

### Download Detection Model

```javascript
const DownloadState = {
  isActive: false,
  startTime: null,
  method: null, // 'navigation', 'iframe', 'response'
  url: null
}
```

## Error Handling

### Download Detection Failures

- **Fallback Timer**: If download detection fails, automatically reset UI after 3 seconds
- **Manual Reset**: Provide user option to manually reset if download doesn't start
- **State Recovery**: Maintain previous search results for quick retry

### State Synchronization Issues

- **State Validation**: Verify UI state consistency before transitions
- **Rollback Mechanism**: Revert to previous stable state on errors
- **Debug Logging**: Track state transitions for troubleshooting

## Testing Strategy

### Unit Testing Focus Areas

1. **State Transitions**: Test all valid state changes and invalid transition prevention
2. **Download Detection**: Mock download scenarios and verify detection accuracy
3. **Message Management**: Verify correct message show/hide behavior
4. **Button State**: Test button enable/disable logic

### Integration Testing

1. **End-to-End Flow**: Complete download process with UI state verification
2. **Multiple Downloads**: Sequential download attempts with proper state reset
3. **Error Scenarios**: Network failures and recovery behavior
4. **Browser Compatibility**: Download detection across different browsers

### Manual Testing Scenarios

1. **Single Video Download**: Verify message progression and button state
2. **Multiple Video Selection**: Test UI behavior with video list display
3. **Failed Downloads**: Ensure proper error state and recovery
4. **Rapid Successive Downloads**: Test state management under quick user actions

## Implementation Approach

### Phase 1: Download Detection Implementation

1. Implement download detection mechanisms
2. Add event listeners for download start detection
3. Create state transition handlers

### Phase 2: Message Management Enhancement

1. Enhance existing `setUIState` function with message-specific controls
2. Implement auto-hide logic for transient messages
3. Add message persistence management

### Phase 3: Button State Management

1. Modify button enable/disable logic
2. Implement proper state reset after downloads
3. Add support for immediate new downloads

### Phase 4: Integration and Testing

1. Integrate all components with existing codebase
2. Test download detection reliability
3. Verify state management across all scenarios