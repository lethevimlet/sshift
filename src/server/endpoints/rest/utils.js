const { detectKeyFormat, convertPPKToOpenSSH } = require('../../utils/key-converter');

function registerUtilsEndpoints(app, io) {
  app.post('/api/utils/detect-key', (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.json({ format: 'unknown', type: 'unknown', encrypted: false });
    }
    try {
      const info = detectKeyFormat(content);
      res.json(info);
    } catch (e) {
      res.json({ format: 'unknown', type: 'unknown', encrypted: false, error: e.message });
    }
  });

  app.post('/api/utils/convert-key', async (req, res) => {
    const { content, passphrase } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'No key content provided' });
    }
    const info = detectKeyFormat(content);
    if (info.format === 'ppk') {
      try {
        const converted = await convertPPKToOpenSSH(content, passphrase);
        res.json({ success: true, key: converted, format: 'openssh' });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    } else {
      res.json({ success: true, key: content, format: info.format });
    }
  });
}

module.exports = { registerUtilsEndpoints };