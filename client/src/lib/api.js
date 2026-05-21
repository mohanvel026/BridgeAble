// client/src/lib/api.js
import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 15000, // Industry standard timeout
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Idempotency tracking for retries
  config.retryCount = config.retryCount || 0;
  return config;
});

// Robust response handling with exponential backoff retries for 5xx/Network errors
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { config, response } = err;
    
    // 1. Auto-logout on 401 Unauthorized
    if (response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token');
      window.location.href = '/login';
      return Promise.reject(err);
    }
    
    // 2. Rate-limit (429) UX handling
    if (response?.status === 429) {
      toast.error('Too many requests. Please slow down.', { id: 'rate-limit' });
      return Promise.reject(err);
    }

    // 3. Network or 5xx error retry logic (Up to 3 retries for GET/PUT)
    const isIdempotent = config?.method === 'get' || config?.method === 'put';
    const isNetworkOrServerErr = !response || (response.status >= 500 && response.status < 600);
    
    if (config && isIdempotent && isNetworkOrServerErr && config.retryCount < 3) {
      config.retryCount += 1;
      const backoffMs = Math.min(1000 * (2 ** config.retryCount), 5000); // 2s, 4s, max 5s
      
      if (config.retryCount === 2) {
        toast.loading('Network degraded. Retrying connection...', { id: 'retry-toast' });
      }
      
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      
      try {
        const result = await api(config);
        toast.dismiss('retry-toast');
        return result;
      } catch (retryErr) {
        return Promise.reject(retryErr);
      }
    }
    
    toast.dismiss('retry-toast');
    
    // 4. Global generic network drop
    if (err.message === 'Network Error' && !response) {
      toast.error('Unable to reach servers. Check your connection.', { id: 'network-err' });
    }

    return Promise.reject(err);
  }
);

export default api;
