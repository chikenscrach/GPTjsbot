'use strict';

const TWITTER_PROVIDERS = Object.freeze(['fixvx.com', 'fixupx.com']);

function normalizeTwitterLanguage(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?$/.test(code)) return null;
  if (['tw', 'zh-tw', 'zh-hk', 'zh-mo'].includes(code) || /^zh-hant(?:-|$)/.test(code)) return 'zh-hant';
  if (['cn', 'zh-cn', 'zh-sg'].includes(code) || /^zh-hans(?:-|$)/.test(code)) return 'zh-hans';
  return code;
}

function twitterLanguageSuffix(language, provider) {
  if (language === 'off') return null;
  if (provider === 'fixupx.com') {
    if (language === 'zh-hant') return 'tw';
    if (language === 'zh-hans') return 'zh';
  }
  return language;
}

module.exports = { TWITTER_PROVIDERS, normalizeTwitterLanguage, twitterLanguageSuffix };
