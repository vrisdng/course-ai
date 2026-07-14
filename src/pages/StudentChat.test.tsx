import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: {} as Record<string, unknown>, auth: {} as Record<string, unknown>, invoke: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock('@/features/student-chat/useStudentChat', () => ({ useStudentChat: vi.fn(() => mocks.chat) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/features/student-chat/ConversationsSidebar', () => ({ ConversationsSidebar: (props: Record<string, unknown>) => <aside>
  <span>{String(props.searchQuery)}</span><button onClick={() => (props.onToggleCollapse as () => void)()}>toggle sidebar</button>
  <button onClick={() => (props.onStartNewConversation as () => void)()}>new conversation</button>
  <button onClick={() => void (props.onEnroll as (code: string) => Promise<void>)('CODE123')}>enroll course</button>
  <span>enroll-visible:{String(props.showEnroll)}</span>
</aside> }));
vi.mock('@/features/student-chat/MessageList', () => ({ MessageList: (props: Record<string, unknown>) => <section>
  messages:{String((props.messages as unknown[]).length)} empty:{String(props.showEmptyState)}
  <button onClick={() => (props.onSuggestionClick as (value: string) => void)('suggestion')}>suggest</button>
</section> }));
vi.mock('@/features/student-chat/ChatComposer', () => ({ ChatComposer: (props: Record<string, unknown>) => <section>
  composer:{String(props.input)} hint:{String(props.documentHint)}
  <button onClick={() => (props.onSend as () => void)()}>send</button>{props.documentSelector as React.ReactNode}
</section> }));
vi.mock('@/features/student-chat/DocumentScopeSelector', () => ({ DocumentScopeSelector: (props: Record<string, unknown>) => <div>
  documents:{String((props.documents as unknown[]).length)} disabled:{String(props.disabled)}
  <button onClick={() => (props.onSelectAllDocuments as () => void)()}>all docs</button>
</div> }));
vi.mock('@/features/student-chat/SourcesPanel', () => ({ SourcesPanel: (props: Record<string, unknown>) => <aside>
  panel:{String(props.showSidePanel)}<button onClick={() => (props.onClosePanel as () => void)()}>close panel</button>
</aside> }));
vi.mock('@/features/student-chat/VideoSourceDialog', () => ({ VideoSourceDialog: (props: Record<string, unknown>) => <div>
  video:{String(Boolean(props.source))}<button onClick={() => (props.onClose as () => void)()}>close video</button>
</div> }));

import StudentChat from './StudentChat';

function Location() { return <output>{useLocation().pathname}</output>; }
function renderPage(path = '/chat') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/chat" element={<><StudentChat /><Location /></>} />
    <Route path="/chat/:conversationId" element={<><StudentChat /><Location /></>} />
  </Routes></MemoryRouter>);
}

describe('StudentChat page', () => {
  const fn = () => vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.auth = { refreshProfile: fn(), isAdmin: false };
    mocks.invoke.mockResolvedValue({ data: { status: 'enrolled' }, error: null });
    mocks.chat = {
      activeVideoSource: null, fetchAccessibleCourses: fn(), availableCourses: [{ id: 'course-1', name: 'Algorithms', code: 'CS101' }],
      isLoadingCourses: false, availableDocuments: [], isLoadingDocuments: false, messages: [], input: '', isLoading: false,
      selectedMessage: null, showSidePanel: true, highlightedCitationKey: null, openingCitationKey: null, conversations: [],
      currentConversationId: null, selectedCourseId: 'course-1', selectedDocumentIds: [], selectedModel: 'fast', setSelectedModel: fn(),
      deletingConversationId: null, isClearingConversations: false, changeSelectedCourse: fn(), toggleSelectedDocument: fn(),
      clearSelectedDocuments: fn(), selectAllDocuments: fn(), applySelectedDocuments: fn(), setInput: fn(), setShowSidePanel: fn(),
      setHighlightedCitationKey: fn(), handleSend: fn(), stopGenerating: fn(), startNewConversation: fn(), selectConversation: fn(),
      deleteConversation: fn(), clearAllConversations: fn(), openSourcesForMessage: fn(), focusCitation: fn(), openCitationSource: fn(),
      closeActiveVideoSource: fn(),
    };
  });
  it('composes course, document, chat, source, and video states', () => {
    renderPage();
    expect(screen.getByText('Algorithms (CS101)')).toBeInTheDocument();
    expect(screen.getByText(/messages:0 empty:true/)).toBeInTheDocument();
    expect(screen.getByText(/hint:No processed documents are available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'suggest' }));
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    fireEvent.click(screen.getByRole('button', { name: 'all docs' }));
    fireEvent.click(screen.getByRole('button', { name: 'close panel' }));
    expect(mocks.chat.setInput).toHaveBeenCalledWith('suggestion'); expect(mocks.chat.handleSend).toHaveBeenCalled();
    expect(mocks.chat.selectAllDocuments).toHaveBeenCalled(); expect(mocks.chat.setShowSidePanel).toHaveBeenCalledWith(false);
  });
  it('syncs a current conversation into the URL and starts new chats at the base route', async () => {
    mocks.chat.currentConversationId = 'conv-2'; renderPage('/chat');
    await waitFor(() => expect(screen.getByText('/chat/conv-2')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'new conversation' }));
    await waitFor(() => expect(screen.getByText('/chat')).toBeInTheDocument());
    expect(mocks.chat.startNewConversation).toHaveBeenCalled();
  });
  it('redeems enrollment codes and refreshes profile and courses', async () => {
    renderPage(); fireEvent.click(screen.getByRole('button', { name: 'enroll course' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('redeem-course-invite', { body: { inviteCode: 'CODE123' } }));
    await waitFor(() => expect(mocks.auth.refreshProfile).toHaveBeenCalled());
    expect(mocks.chat.fetchAccessibleCourses).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Successfully enrolled!');
  });
  it('hides enrollment for admins and displays course-loading state', () => {
    mocks.auth.isAdmin = true; mocks.chat.isLoadingCourses = true; mocks.chat.selectedCourseId = null;
    renderPage(); expect(screen.getByText('Loading course...')).toBeInTheDocument();
    expect(screen.getByText('enroll-visible:false')).toBeInTheDocument();
  });
});
