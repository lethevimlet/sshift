---
layout: page
title: API Reference
---

# API Reference

## Socket.IO Events

### Client → Server

#### SSH Connection

```javascript
// SSH Connection
socket.emit('ssh-connect', {
  sessionId: 'unique-session-id',
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'pass',
  cols: 80,
  rows: 24
});
```

#### SSH Data

```javascript
// SSH Data
socket.emit('ssh-data', {
  sessionId: 'session-id',
  data: 'ls -la\n'
});
```

#### SSH Resize

```javascript
// SSH Resize
socket.emit('ssh-resize', {
  sessionId: 'session-id',
  cols: 120,
  rows: 40
});
```

#### SSH Disconnect

```javascript
// SSH Disconnect
socket.emit('ssh-disconnect', {
  sessionId: 'session-id'
});
```

#### SFTP Connection

```javascript
// SFTP Connection
socket.emit('sftp-connect', {
  sessionId: 'unique-session-id',
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'pass'
});
```

#### SFTP List Directory

```javascript
// SFTP List Directory
socket.emit('sftp-list', {
  sessionId: 'session-id',
  path: '/home/user'
});
```

### Server → Client

#### SSH Connected

```javascript
// SSH Connected
socket.on('ssh-connected', (data) => {
  console.log('Session ID:', data.sessionId);
});
```

#### SSH Data

```javascript
// SSH Data
socket.on('ssh-data', (data) => {
  console.log('Output:', data.data);
});
```

#### SSH Error

```javascript
// SSH Error
socket.on('ssh-error', (data) => {
  console.error('Error:', data.message);
});
```

#### SFTP Connected

```javascript
// SFTP Connected
socket.on('sftp-connected', (data) => {
  console.log('SFTP Session ID:', data.sessionId);
});
```

#### SFTP List Result

```javascript
// SFTP List Result
socket.on('sftp-list-result', (data) => {
  console.log('Files:', data.files);
});
```

## Event Reference

### SSH Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `ssh-connect` | Client → Server | Initiate SSH connection |
| `ssh-data` | Client → Server | Send data to SSH session |
| `ssh-resize` | Client → Server | Resize terminal dimensions |
| `ssh-disconnect` | Client → Server | Close SSH connection |
| `ssh-connected` | Server → Client | SSH connection established |
| `ssh-data` | Server → Client | Receive SSH output |
| `ssh-error` | Server → Client | SSH error occurred |

### SFTP Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `sftp-connect` | Client → Server | Initiate SFTP connection |
| `sftp-list` | Client → Server | List directory contents |
| `sftp-connected` | Server → Client | SFTP connection established |
| `sftp-list-result` | Server → Client | Directory listing result |
| `sftp-error` | Server → Client | SFTP error occurred |

## Data Structures

### SSH Connection Options

```typescript
interface SSHConnectOptions {
  sessionId: string;    // Unique session identifier
  host: string;         // SSH server hostname
  port: number;         // SSH server port (default: 22)
  username: string;     // SSH username
  password?: string;    // SSH password (optional if using key)
  privateKey?: string;  // SSH private key (optional)
  cols: number;         // Terminal columns
  rows: number;         // Terminal rows
}
```

### SFTP Connection Options

```typescript
interface SFTPConnectOptions {
  sessionId: string;    // Unique session identifier
  host: string;         // SFTP server hostname
  port: number;         // SFTP server port (default: 22)
  username: string;     // SFTP username
  password?: string;    // SFTP password (optional if using key)
  privateKey?: string;  // SFTP private key (optional)
}
```

### File Info

```typescript
interface FileInfo {
  name: string;         // File name
  path: string;         // Full path
  size: number;         // File size in bytes
  type: 'file' | 'directory' | 'symlink';
  permissions: string;  // Unix permissions (e.g., 'drwxr-xr-x')
  owner: string;        // Owner name
  group: string;        // Group name
  modifiedAt: Date;     // Last modified timestamp
}
```

## Error Handling

All errors are emitted through the `ssh-error` or `sftp-error` events:

```javascript
socket.on('ssh-error', (error) => {
  console.error('SSH Error:', error.message);
  // Handle error appropriately
});

socket.on('sftp-error', (error) => {
  console.error('SFTP Error:', error.message);
  // Handle error appropriately
});
```

## Best Practices

### Session Management

- Use unique `sessionId` values for each session
- Clean up sessions on disconnect
- Handle reconnection gracefully

### Security

- Never send credentials over unencrypted connections
- Use environment variables for sensitive data
- Implement proper authentication checks

### Performance

- Limit concurrent sessions appropriately
- Implement rate limiting for SFTP operations
- Use connection pooling for multiple sessions