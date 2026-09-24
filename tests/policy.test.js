import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAllowedUrl, extractAllowedUrl, buildRules} from '../extension/policy.js';

test('HTTPS token rules include host, path, query and ignore case', () => {
  for (const url of ['https://mvfile.example/a', 'https://example.test/MVFILE/a',
    'https://example.test/?q=mvfile', 'https://gofile.io/d/123', 'https://twitmg.online/', 'https://pbs.twimg.com/a']) {
    assert.equal(parseAllowedUrl(url), new URL(url).href);
  }
});
test('named hosts are exact or intended subdomains only', () => {
  for (const url of ['https://x.com/home', 'https://api.x.com/a', 'https://t.co/123',
    'https://goflie.top/', 'https://cdn.goflie.top/video']) assert.ok(parseAllowedUrl(url));
  for (const url of ['https://notx.com/', 'https://x.com.evil.test/', 'https://sub.t.co/',
    'https://fun800.click/a', 'https://example.test/?url=x.com',
    'https://goflie.top.evil.test/', 'https://example.test/?url=goflie.top']) assert.equal(parseAllowedUrl(url), null);
});
test('HTTP, credentials, malformed and fragment-only tokens cannot grant access', () => {
  for (const url of [null, {}, '', 'not a url', 'http://mvfile.test/', 'http://twitmg.online/', 'javascript:mvfile',
    'file:///mvfile', 'https://example.test/#mvfile', 'https://user:pass@mvfile.test/']) {
    assert.equal(parseAllowedUrl(url), null);
  }
  assert.ok(parseAllowedUrl('https://mvfile.test/#section'));
});
test('shared text selects an allowed URL and strips sentence punctuation', () => {
  assert.equal(extractAllowedUrl('別URL https://example.test/ 本命 https://mvfile.test/a。'), 'https://mvfile.test/a');
  assert.equal(extractAllowedUrl('http://mvfile.test/'), null);
});
test('session rules scope attachment suppression to top-level navigation', () => {
  assert.deepEqual(buildRules([]), []);
  assert.throws(() => buildRules([-1]));
  const rules = buildRules([4, 7, 4]);
  for (const rule of rules) assert.deepEqual(rule.condition.tabIds, [4, 7]);
  assert.ok(rules.find(r => r.id === 1).condition.resourceTypes.includes('main_frame'));
  assert.match('https://twitmg.online/', new RegExp(rules.find(r => r.id === 2).condition.regexFilter, 'i'));
  const namedHosts = new RegExp(rules.find(r => r.id === 3).condition.regexFilter, 'i');
  assert.match('https://cdn.goflie.top/video', namedHosts);
  assert.doesNotMatch('https://goflie.top.evil.test/video', namedHosts);
  assert.deepEqual(rules.find(r => r.id === 4).condition.excludedResourceTypes, ['main_frame']);
  assert.deepEqual(rules.find(r => r.id === 5).condition.resourceTypes, ['main_frame']);
  assert.ok(rules.find(r => r.id === 5).priority > rules.find(r => r.id === 2).priority);
});
