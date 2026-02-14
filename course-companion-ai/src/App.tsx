import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

// Pages
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import StudentChat from "./pages/StudentChat";
import AdminDashboard from "./pages/AdminDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />

            {/* Protected student routes */}
            <Route
              path="/chat/:conversationId?"
              element={
                <ProtectedRoute requiredRole={['student', 'admin']}>
                  <StudentChat />
                </ProtectedRoute>
              }
            />

            {/* Protected staff routes */}
            <Route
              path="/admin-dashboard"
              element={
                <ProtectedRoute requiredRole={['admin', 'lecturer']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/admin" element={<Navigate to="/admin-dashboard" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
