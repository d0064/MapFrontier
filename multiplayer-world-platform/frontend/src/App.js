import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Store
import useGameStore from './stores/gameStore';

// Services
import { authAPI } from './services/api';
import { initializeSocket } from './services/socket';

// Components
import LoadingScreen from './components/ui/LoadingScreen';
import ErrorBoundary from './components/ui/ErrorBoundary';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import GamePage from './pages/GamePage';

// Styles
import './index.css';
import 'leaflet/dist/leaflet.css';

function App() {
  const {
    isAuthenticated,
    token,
    player,
    isLoading,
    setAuth,
    setPlayer,
    setLoading,
    setError,
    logout
  } = useGameStore();

  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Verify token and get player data
        const response = await authAPI.verify();
        
        if (response.data.valid) {
          // Get full profile
          const profileResponse = await authAPI.getProfile();
          setPlayer(profileResponse.data.player);
          
          // Initialize socket connection
          await initializeSocket(token);
        } else {
          logout();
        }
      } catch (error) {
        console.error('App initialization error:', error);
        logout();
      } finally {
        setLoading(false);
      }
    };

    initializeApp();
  }, [token, setAuth, setPlayer, setLoading, setError, logout]);

  // Show loading screen during initialization
  if (isLoading) {
    return <LoadingScreen message="Initializing game..." />;
  }

  return (
    <ErrorBoundary>
      <div className="App">
        <Router>
          <Routes>
            {/* Public routes */}
            <Route 
              path="/login" 
              element={
                isAuthenticated ? 
                <Navigate to="/" replace /> : 
                <LoginPage />
              } 
            />
            <Route 
              path="/register" 
              element={
                isAuthenticated ? 
                <Navigate to="/" replace /> : 
                <RegisterPage />
              } 
            />
            
            {/* Protected routes */}
            <Route 
              path="/" 
              element={
                isAuthenticated ? 
                <GamePage /> : 
                <Navigate to="/login" replace />
              } 
            />
            
            {/* Catch all route */}
            <Route 
              path="*" 
              element={<Navigate to="/" replace />} 
            />
          </Routes>
        </Router>

        {/* Toast notifications */}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
            success: {
              duration: 3000,
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              duration: 5000,
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </div>
    </ErrorBoundary>
  );
}

export default App;