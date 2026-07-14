import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsSidebar } from './ConversationsSidebar';

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
const conversations = [
  { id: 'c1', title: 'React concepts', createdAt: '2026-01-01', courseId: 'course-1' },
  { id: 'c2', title: 'Database review', createdAt: '2026-01-02', courseId: 'course-1' },
];
const props = () => ({
  conversations, currentConversationId: 'c1', deletingConversationId: null, isClearingConversations: false,
  isCollapsed: false, searchQuery: '', availableCourses: [{ id: 'course-1', name: 'Algorithms', code: 'CS101' }],
  selectedCourseId: 'course-1', isLoadingCourses: false, onSelectConversation: vi.fn(), onStartNewConversation: vi.fn(),
  onDeleteConversation: vi.fn(), onClearHistory: vi.fn(), onToggleCollapse: vi.fn(), onSearchChange: vi.fn(),
  onChangeCourse: vi.fn(), onEnroll: vi.fn().mockResolvedValue(undefined), showEnroll: true,
});
const renderSidebar = (value: ReturnType<typeof props>) => render(<MemoryRouter><ConversationsSidebar {...value} /></MemoryRouter>);

describe('ConversationsSidebar', () => {
  beforeEach(() => mocks.toastError.mockReset());
  it('expands from collapsed mode', () => {
    const value = props(); value.isCollapsed = true; renderSidebar(value);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(value.onToggleCollapse).toHaveBeenCalled();
  });
  it('starts and selects chats, filters titles, clears search, and clears history', () => {
    const value = props(); value.searchQuery = 'react'; renderSidebar(value);
    expect(screen.getByText('React concepts')).toBeInTheDocument(); expect(screen.queryByText('Database review')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'React concepts' }));
    fireEvent.change(screen.getByPlaceholderText('Search conversations...'), { target: { value: 'database' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear History' }));
    expect(value.onStartNewConversation).toHaveBeenCalled(); expect(value.onSelectConversation).toHaveBeenCalledWith('c1');
    expect(value.onSearchChange).toHaveBeenNthCalledWith(1, 'database'); expect(value.onSearchChange).toHaveBeenNthCalledWith(2, '');
    expect(value.onClearHistory).toHaveBeenCalled();
  });
  it('renders empty/search and busy destructive states', () => {
    const value = props(); value.conversations = []; value.searchQuery = 'none';
    const { unmount } = renderSidebar(value); expect(screen.getByText('No conversations match your search.')).toBeInTheDocument(); unmount();
    const busy = props(); busy.isClearingConversations = true; renderSidebar(busy);
    expect(screen.getByRole('button', { name: /Clearing/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'More actions for React concepts' })).toBeDisabled();
  });
  it('opens course management and switches courses', () => {
    const value = props(); value.availableCourses.push({ id: 'course-2', name: 'Databases', code: null }); renderSidebar(value);
    fireEvent.click(screen.getByRole('button', { name: /Algorithms/ }));
    expect(screen.getByText('Your Courses (2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Databases' }));
    expect(value.onChangeCourse).toHaveBeenCalledWith('course-2');
  });
  it('normalizes invite codes and closes after successful enrollment', async () => {
    const value = props(); value.availableCourses = []; value.selectedCourseId = null; renderSidebar(value);
    fireEvent.click(screen.getByRole('button', { name: 'Enroll in Course' }));
    const input = screen.getByLabelText('Invite code');
    fireEvent.change(input, { target: { value: ' ab3x7 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(value.onEnroll).toHaveBeenCalledWith('AB3X7'));
    await waitFor(() => expect(screen.queryByText('Enroll in a Course')).not.toBeInTheDocument());
  });
  it('shows enrollment failures and keeps the manager open for retry', async () => {
    const value = props(); value.availableCourses = []; value.selectedCourseId = null;
    value.onEnroll.mockRejectedValueOnce(new Error('Invalid invite')); renderSidebar(value);
    fireEvent.click(screen.getByRole('button', { name: 'Enroll in Course' }));
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'badcode' } });
    fireEvent.keyDown(screen.getByLabelText('Invite code'), { key: 'Enter' });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Invalid invite'));
    expect(screen.getByText('Enroll in a Course')).toBeInTheDocument();
  });
});
