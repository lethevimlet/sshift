/**
 * Unit tests for Speech & AI settings profiles (config helpers).
 *
 * Profiles are named snapshots of the speech-ai settings (endpoints, auth
 * keys, language, model, wand prompt) stored server-side in config.json so
 * users can fast-swap between endpoint setups (e.g. a local Whisper/LLM
 * stack vs a cloud provider). Auth keys live inside the snapshots but are
 * never exposed through the public (redacted) config.
 *
 * The fs module is mocked with an in-memory store so these tests never
 * touch the developer's real config.json.
 */

jest.mock('fs', () => {
  const files = new Map();
  return {
    __files: files,
    existsSync: (p) => files.has(String(p)),
    readFileSync: (p) => {
      const key = String(p);
      if (!files.has(key)) {
        const err = new Error(`ENOENT: no such file or directory, open '${key}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(key);
    },
    writeFileSync: (p, data) => { files.set(String(p), String(data)); },
    mkdirSync: () => {},
    readdirSync: () => [],
    statSync: () => ({ isDirectory: () => false })
  };
});

const fs = require('fs');
const {
  loadConfig,
  saveConfig,
  listSpeechAiProfiles,
  saveSpeechAiProfile,
  loadSpeechAiProfile,
  deleteSpeechAiProfile,
  getSpeechAiPublicConfig,
  getSpeechAiConfig
} = require('../../server/utils/config');

const LOCAL = {
  sttEndpoint: 'http://192.168.1.10:9000/v1/audio/transcriptions',
  sttAuthKey: 'local-stt-key',
  sttLanguage: 'en',
  llmEndpoint: 'http://192.168.1.10:8080/v1/chat/completions',
  llmAuthKey: 'local-llm-key',
  llmModel: 'llama-3.1-8b-instruct',
  wandSystemPrompt: 'local prompt'
};

const CLOUD = {
  sttEndpoint: 'https://api.deepinfra.com/v1/openai/audio/transcriptions',
  sttAuthKey: 'cloud-stt-key',
  sttLanguage: '',
  llmEndpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
  llmAuthKey: 'cloud-llm-key',
  llmModel: 'meta-llama/Llama-3.3-70B-Instruct',
  wandSystemPrompt: 'cloud prompt'
};

function applyActiveSettings(values) {
  const config = loadConfig();
  Object.assign(config, values);
  expect(saveConfig(config)).toBe(true);
}

describe('Speech & AI profiles (server config helpers)', () => {
  beforeEach(() => {
    fs.__files.clear();
  });

  test('starts with no profiles', () => {
    expect(listSpeechAiProfiles()).toEqual([]);
  });

  test('save → list → load round trip applies all fields including auth keys', () => {
    applyActiveSettings(LOCAL);
    expect(saveSpeechAiProfile('local')).toBe(true);

    applyActiveSettings(CLOUD);
    expect(saveSpeechAiProfile('cloud')).toBe(true);

    // Sorted names.
    expect(listSpeechAiProfiles()).toEqual(['cloud', 'local']);

    // Active config currently holds the cloud values.
    expect(getSpeechAiConfig().sttEndpoint).toBe(CLOUD.sttEndpoint);

    // Fast-swap back to the local profile.
    expect(loadSpeechAiProfile('local')).toBe(true);
    const active = getSpeechAiConfig();
    expect(active).toEqual(LOCAL);
  });

  test('loading a profile does not clobber unrelated config keys', () => {
    const config = loadConfig();
    config.port = 9999;
    config.bookmarks = [{ id: 'b1', host: 'example.com' }];
    saveConfig(config);

    applyActiveSettings(LOCAL);
    saveSpeechAiProfile('local');
    applyActiveSettings(CLOUD);
    loadSpeechAiProfile('local');

    const after = loadConfig();
    expect(after.port).toBe(9999);
    expect(after.bookmarks).toEqual([{ id: 'b1', host: 'example.com' }]);
    expect(after.sttAuthKey).toBe(LOCAL.sttAuthKey);
  });

  test('saving an existing name overwrites the snapshot', () => {
    applyActiveSettings(LOCAL);
    saveSpeechAiProfile('main');
    applyActiveSettings(CLOUD);
    saveSpeechAiProfile('main');

    expect(listSpeechAiProfiles()).toEqual(['main']);
    // Wipe active values, then load — must get the CLOUD snapshot.
    applyActiveSettings({ ...LOCAL, sttEndpoint: 'http://other' });
    loadSpeechAiProfile('main');
    expect(getSpeechAiConfig()).toEqual(CLOUD);
  });

  test('delete removes only the named profile', () => {
    applyActiveSettings(LOCAL);
    saveSpeechAiProfile('local');
    applyActiveSettings(CLOUD);
    saveSpeechAiProfile('cloud');

    expect(deleteSpeechAiProfile('cloud')).toBe(true);
    expect(listSpeechAiProfiles()).toEqual(['local']);
    // Deleting a profile leaves the active settings untouched.
    expect(getSpeechAiConfig()).toEqual(CLOUD);
  });

  test('load/delete of unknown profiles return false', () => {
    expect(loadSpeechAiProfile('nope')).toBe(false);
    expect(deleteSpeechAiProfile('nope')).toBe(false);
  });

  test('profiles never leak auth keys through the public config', () => {
    applyActiveSettings(LOCAL);
    saveSpeechAiProfile('local');

    const pub = getSpeechAiPublicConfig();
    expect(pub.sttAuthKeySet).toBe(true);
    expect(pub.llmAuthKeySet).toBe(true);
    expect(JSON.stringify(pub)).not.toContain(LOCAL.sttAuthKey);
    expect(JSON.stringify(pub)).not.toContain(LOCAL.llmAuthKey);
    // And the public shape has no profiles blob at all.
    expect(pub.speechAiProfiles).toBeUndefined();
  });

  test('handles a legacy config where speechAiProfiles is missing or invalid', () => {
    const config = loadConfig();
    delete config.speechAiProfiles;
    saveConfig(config);
    expect(listSpeechAiProfiles()).toEqual([]);

    const config2 = loadConfig();
    config2.speechAiProfiles = 'garbage';
    saveConfig(config2);
    expect(listSpeechAiProfiles()).toEqual([]);
    // Saving repairs the container.
    applyActiveSettings(LOCAL);
    expect(saveSpeechAiProfile('fixed')).toBe(true);
    expect(listSpeechAiProfiles()).toEqual(['fixed']);
  });
});
