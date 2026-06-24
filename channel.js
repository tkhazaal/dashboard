// Shared UTM → channel-type resolver (used by analytics + samcart so labels match).
//  1) known channel-type content (fb_post…) → clean label
//  2) a clean new slug (yt_shorts)          → title-cased (auto-detected)
//  3) creative content (subject lines, ad IDs) → source+medium bucket
const UTM_CHANNELS = {        // utm_content → channel label (the agreed scheme)
  fb_post: 'FB Post', fb_posts: 'FB Post', fb_stories: 'FB Stories', fb_story: 'FB Stories',
  ig_post: 'IG Post', ig_posts: 'IG Post', ig_stories: 'IG Stories', ig_story: 'IG Stories',
  fb_group: 'FB Group', email: 'Email', tiktok: 'TikTok', tt: 'TikTok',
  fb_ads: 'FB Ads', fb_ad: 'FB Ads', fbads: 'FB Ads',
};
const SRC_MED_CHANNELS = {    // source|medium → channel (fallback for legacy/creative content)
  'facebook|paid_social': 'FB Ads', 'fb|paid': 'FB Ads', 'facebook|paid': 'FB Ads', 'fb|paid_social': 'FB Ads',
  'facebook|community': 'FB Group',
  'facebook|social': 'Facebook (Social)', 'fb|social': 'Facebook (Social)',
  'instagram|social': 'Instagram (Social)', 'ig|social': 'Instagram (Social)',
  'instagram|paid_social': 'IG Ads', 'ig|paid': 'IG Ads', 'instagram|paid': 'IG Ads', 'ig|paid_social': 'IG Ads',
  'tiktok|social': 'TikTok', 'tiktok|paid_social': 'TikTok', 'tiktok|paid': 'TikTok',
};
const titleize = s => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();

function utmChannel(content, source, medium) {
  const c = String(content || '').toLowerCase().trim();
  if (UTM_CHANNELS[c]) return UTM_CHANNELS[c];
  if (/^[a-z][a-z0-9_]{0,23}$/.test(c)) return titleize(c);
  const s = String(source || '').toLowerCase().trim(), m = String(medium || '').toLowerCase().trim();
  if (SRC_MED_CHANNELS[s + '|' + m]) return SRC_MED_CHANNELS[s + '|' + m];
  if (m === 'email' || s === 'email') return 'Email';
  if (s) return titleize(s) + (m ? ' · ' + titleize(m) : '');
  return '(untagged)';
}

module.exports = { utmChannel, titleize, UTM_CHANNELS, SRC_MED_CHANNELS };
