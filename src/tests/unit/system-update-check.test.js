const { EventEmitter } = require('events');

const {
  compareVersions,
  getLatestPublishedVersion
} = require('../../server/endpoints/rest/system');

function mockRequest(responses) {
  return (options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = jest.fn();
    request.destroy = (error) => request.emit('error', error);
    request.end = () => {
      const responseData = responses.shift();
      const response = new EventEmitter();
      response.statusCode = responseData.statusCode;
      callback(response);
      process.nextTick(() => {
        response.emit('data', Buffer.from(responseData.body));
        response.emit('end');
      });
    };
    return request;
  };
}

describe('system update checks', () => {
  test('uses the latest version published on npm', async () => {
    const request = mockRequest([{ statusCode: 200, body: JSON.stringify({ version: '1.9.0' }) }]);

    await expect(getLatestPublishedVersion(request)).resolves.toBe('1.9.0');
  });

  test('falls back to GitHub when npm metadata is unavailable', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const githubPackage = Buffer.from(JSON.stringify({ version: '1.9.1' })).toString('base64');
    const request = mockRequest([
      { statusCode: 503, body: 'unavailable' },
      { statusCode: 200, body: JSON.stringify({ content: githubPackage }) }
    ]);

    await expect(getLatestPublishedVersion(request)).resolves.toBe('1.9.1');
    expect(warning).toHaveBeenCalledWith(
      '[UPDATE] npm version check failed, trying GitHub:',
      'registry.npmjs.org returned 503'
    );
    warning.mockRestore();
  });

  test('compares semantic version components numerically', () => {
    expect(compareVersions('1.8.3', '1.9.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.9.0', '1.9.0')).toBe(0);
  });
});
