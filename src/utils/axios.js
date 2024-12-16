const axios = require('axios');
const dns = require('dns').promises;

// Shared axios instance dengan optimisasi
const axiosInstance = axios.create({
  timeout: 10000,
  headers: {
    'Connection': 'keep-alive',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  },
  httpAgent: new require('http').Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50
  }),
  httpsAgent: new require('https').Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50
  }),
  // Handle redirects
  maxRedirects: 5,
  validateStatus: function (status) {
    // Accept both 200 and 301/302 redirects
    return status >= 200 && status < 400;
  }
});

// Add request interceptor to check DNS and handle retries
axiosInstance.interceptors.request.use(async config => {
  try {
    // Extract hostname from URL
    const urlObj = new URL(config.url);

    // Try to resolve DNS
    await dns.lookup(urlObj.hostname);

    return config;
  } catch (error) {
    // If DNS lookup fails, wait and retry
    await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      await dns.lookup(urlObj.hostname);
      return config;
    } catch {
      throw new Error(`DNS lookup failed for ${config.url}. Site might be down.`);
    }
  }
});

// Add request interceptor to ensure default=true parameter
axiosInstance.interceptors.request.use(config => {
  if (config.url.includes('/chapter-')) {
    const hasParams = config.url.includes('?');
    config.url = config.url + (hasParams ? '&' : '?') + 'default=true';
  }
  return config;
});

module.exports = axiosInstance;
