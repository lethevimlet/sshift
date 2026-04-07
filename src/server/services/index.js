/**
 * Services module index
 * Re-exports all service modules
 */

const sshManager = require('./ssh-manager');
const sftpManager = require('./sftp-manager');

module.exports = {
  sshManager,
  sftpManager
};