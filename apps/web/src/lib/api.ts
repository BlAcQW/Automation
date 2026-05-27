import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor to handle token refresh
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        const isRefreshCall = originalRequest?.url?.includes('/auth/refresh');

        // If refresh itself returned 401, the user is truly unauthenticated.
        // Bail out — do not enter the retry path or we'll loop forever.
        if (error.response?.status === 401 && isRefreshCall) {
            localStorage.removeItem('accessToken');
            if (typeof window !== 'undefined') window.location.href = '/login';
            return Promise.reject(error);
        }

        // If 401 on a normal endpoint and not already retrying
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                // Try to refresh the token
                const response = await api.post('/auth/refresh');
                const { accessToken } = response.data;

                localStorage.setItem('accessToken', accessToken);
                originalRequest.headers.Authorization = `Bearer ${accessToken}`;

                return api(originalRequest);
            } catch (refreshError) {
                // Refresh failed, clear token and redirect to login
                localStorage.removeItem('accessToken');
                window.location.href = '/login';
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

// Admin API (separate base for admin routes)
export const adminApi = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

adminApi.interceptors.request.use((config) => {
    const token = localStorage.getItem('adminAccessToken');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

adminApi.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        const isRefreshCall = originalRequest?.url?.includes('/admin/auth/refresh');

        if (error.response?.status === 401 && isRefreshCall) {
            localStorage.removeItem('adminAccessToken');
            if (typeof window !== 'undefined') window.location.href = '/admin/login';
            return Promise.reject(error);
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const response = await adminApi.post('/admin/auth/refresh');
                const { accessToken } = response.data;

                localStorage.setItem('adminAccessToken', accessToken);
                originalRequest.headers.Authorization = `Bearer ${accessToken}`;

                return adminApi(originalRequest);
            } catch (refreshError) {
                localStorage.removeItem('adminAccessToken');
                window.location.href = '/admin/login';
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);
