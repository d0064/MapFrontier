import axios from 'axios';
import toast from 'react-hot-toast';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Create axios instance
const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.message || error.message || 'An error occurred';
    
    // Don't show toast for certain errors
    const silentErrors = ['Authentication failed', 'Invalid token', 'Token has expired'];
    if (!silentErrors.some(silent => message.includes(silent))) {
      toast.error(message);
    }
    
    // Handle auth errors
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  register: (userData) => api.post('/auth/register', userData),
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  getProfile: () => api.get('/auth/profile'),
  updateProfile: (updates) => api.put('/auth/profile', updates),
  verify: () => api.get('/auth/verify'),
  getStats: () => api.get('/auth/stats')
};

// Countries API
export const countriesAPI = {
  getAll: (params = {}) => api.get('/countries', { params }),
  getById: (id) => api.get(`/countries/${id}`),
  join: (id, data = {}) => api.post(`/countries/${id}/join`, data),
  leave: (id) => api.post(`/countries/${id}/leave`),
  getSoldiers: (id, params = {}) => api.get(`/countries/${id}/soldiers`, { params }),
  getHistory: (id, params = {}) => api.get(`/countries/${id}/history`, { params }),
  getBoundaries: (id) => api.get(`/countries/${id}/boundaries`),
  updateSettings: (id, settings) => api.put(`/countries/${id}/settings`, settings),
  search: (params) => api.get('/countries/search', { params })
};

// Players API
export const playersAPI = {
  move: (position) => api.post('/players/move', position),
  getPosition: () => api.get('/players/position'),
  getNearby: (params = {}) => api.get('/players/nearby', { params }),
  getMovementHistory: (params = {}) => api.get('/players/movement-history', { params }),
  getById: (id) => api.get(`/players/${id}`),
  getAll: (params = {}) => api.get('/players', { params }),
  getLeaderboard: (params = {}) => api.get('/players/leaderboard', { params })
};

// Game API
export const gameAPI = {
  declareWar: (data) => api.post('/game/declare-war', data),
  borderPush: (data) => api.post('/game/border-push', data),
  joinBorderPush: (id) => api.post(`/game/border-push/${id}/join`),
  defendBorderPush: (id) => api.post(`/game/border-push/${id}/defend`),
  endWar: (id) => api.post(`/game/end-war/${id}`),
  getWars: (params = {}) => api.get('/game/wars', { params }),
  getBorderPushes: (params = {}) => api.get('/game/border-pushes', { params })
};

// Utility functions
export const handleApiError = (error) => {
  const message = error.response?.data?.message || error.message || 'An error occurred';
  console.error('API Error:', error);
  return message;
};

export const isApiError = (error) => {
  return error.response && error.response.data;
};

// Helper function to get error message
export const getErrorMessage = (error) => {
  if (isApiError(error)) {
    return error.response.data.message || 'An error occurred';
  }
  return error.message || 'Network error';
};

// Upload file helper (for future avatar uploads)
export const uploadFile = async (file, onProgress = () => {}) => {
  const formData = new FormData();
  formData.append('file', file);
  
  return api.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    },
    onUploadProgress: (progressEvent) => {
      const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
      onProgress(progress);
    }
  });
};

export default api;