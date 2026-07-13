import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

// Pages
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import StudentChat from "./pages/StudentChat";
import AdminDashboard from "./pages/AdminDashboard";
import AdminAnalytics from "./pages/AdminAnalytics";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const App = () => (
  <AuthProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {import.meta.env.VITE_MAINTENANCE_MODE === "true" && (
        <AlertDialog open>
          <AlertDialogContent className="[&>button]:hidden">
            <AlertDialogHeader>
              <AlertDialogTitle>EduChat is under maintenance</AlertDialogTitle>
              <AlertDialogDescription>
                The website will resume by 15th July. Thanks for your patience and understanding.
              </AlertDialogDescription>
            </AlertDialogHeader>
          </AlertDialogContent>
        </AlertDialog>
      )}
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
              <ProtectedRoute requiredRole={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin-analytics"
            element={
              <ProtectedRoute requiredRole={['admin']}>
                <AdminAnalytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute requiredRole={['student', 'admin']}>
                <Settings />
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
);

export default App;
