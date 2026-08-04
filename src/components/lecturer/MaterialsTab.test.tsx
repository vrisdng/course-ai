import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: {} as Record<string, unknown>,
  upload: {} as Record<string, unknown>,
  actions: {} as Record<string, unknown>,
  from: vi.fn(),
  update: vi.fn(),
  in: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/features/materials/useMaterialsList', () => ({ useMaterialsList: () => mocks.list }));
vi.mock('@/features/materials/useMaterialUpload', () => ({
  useMaterialUpload: () => mocks.upload,
  ACCEPTED_FILE_TYPES: '.pdf,.doc,.docx,.mp4',
  INLINE_GEMINI_MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024,
}));
vi.mock('@/features/materials/useMaterialActions', () => ({ useMaterialActions: () => mocks.actions }));
vi.mock('./LinkedUrlDialog', () => ({ LinkedUrlDialog: () => null }));
vi.mock('./TranscriptDialog', () => ({ TranscriptDialog: () => null }));
vi.mock('./EditFileNameDialog', () => ({ EditFileNameDialog: () => null }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) => <select aria-label="selection" value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
import { MaterialsTab } from './MaterialsTab';

const fn = () => vi.fn();
const video = { id: 'm1', file_name: 'lecture.mp4', file_type: 'video', file_size: 2048, duration_ms: 65000, course_id: 'c1', academic_term_id: 't1', access_scope: 'course', processing_status: 'processing', processing_progress: 42, processing_stage: 'transcribing', processing_error: null, linked_url: null };
const failed = { ...video, id: 'm2', file_name: 'notes.pdf', file_type: 'pdf', access_scope: 'private', processing_status: 'failed', processing_error: 'Could not parse', academic_term_id: null };

describe('MaterialsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.in.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ in: mocks.in });
    mocks.from.mockReturnValue({ update: mocks.update });
    mocks.list = { materials: [video, failed], isLoadingMaterials: false, searchQuery: '', setSearchQuery: fn(), showFilters: false, setShowFilters: fn(), courseFilter: 'all', setCourseFilter: fn(), accessFilter: 'all', setAccessFilter: fn(), academicTermFilter: 'all', setAcademicTermFilter: fn(), documentTypeFilter: 'all', setDocumentTypeFilter: fn(), dateFilter: 'all', setDateFilter: fn(), statusFilter: 'all', setStatusFilter: fn(), fetchMaterials: fn(), setMaterials: fn(), materialsPage: 1, setMaterialsPage: fn(), totalMaterialPages: 2, totalMaterialsCount: 12, visibleMaterialRangeStart: 1, visibleMaterialRangeEnd: 10 };
    mocks.upload = { fileInputRef: { current: null }, pendingFiles: [], isUploading: false, isDragActive: false, handleFileInputChange: fn(), handleOpenFilePicker: fn(), handleDragOver: fn(), handleDragLeave: fn(), handleDrop: fn(), getPendingFileKey: (f: File) => f.name, removePendingFile: fn(), handleCancelUpload: fn(), handleUpload: fn(), currentUploadFileName: null, currentUploadFileSize: null, currentUploadIndex: null, currentUploadProgress: null, currentUploadStatusText: null };
    mocks.actions = { linkedUrlMaterial: null, linkedUrlValue: '', isSavingLinkedUrl: false, setLinkedUrlValue: fn(), closeLinkedUrlDialog: fn(), handleSaveLinkedUrl: fn(), transcriptMaterial: null, transcriptSegments: [], isLoadingTranscript: false, closeTranscriptDialog: fn(), editingFileNameMaterial: null, editingFileNameValue: '', isUpdatingFileName: false, setEditingFileNameValue: fn(), closeEditFileNameDialog: fn(), handleUpdateFileName: fn(), handleAttachLink: fn(), handleOpenTranscript: fn(), reindexingIds: new Set(), handleReindexMaterial: fn(), openEditFileNameDialog: fn(), handleDeleteMaterial: fn() };
  });
  const renderTab = () => render(<MaterialsTab uploaderId="u1" courses={[{ id: 'c1', name: 'Algorithms', code: 'CS101' } as never]} academicTerms={[{ id: 't1', label: 'Semester 1', is_active: true }, { id: 't2', label: 'Semester 2', is_active: false }] as never} isLoadingTerms={false} />);
  it('renders meaningful material metadata, status, filtering and pagination controls', () => {
    renderTab();
    expect(screen.getByText('lecture.mp4')).toBeInTheDocument(); expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('Transcribing')).toBeInTheDocument(); expect(screen.getByText('Could not parse')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search uploaded materials'), { target: { value: 'lecture' } });
    fireEvent.click(screen.getByRole('button', { name: /Filters/ })); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(mocks.list.setSearchQuery).toHaveBeenCalledWith('lecture'); expect(mocks.list.setShowFilters).toHaveBeenCalled(); expect(mocks.list.setMaterialsPage).toHaveBeenCalled();
  });
  it('validates upload setup before opening the picker', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Complete these steps before adding files/ }));
    expect(mocks.upload.handleOpenFilePicker).toHaveBeenCalledWith('Select the course for this document first');
  });
  it('completes upload metadata and opens the file picker with no validation error', () => {
    renderTab(); const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'c1' } }); fireEvent.change(selects[1], { target: { value: 't1' } }); fireEvent.click(screen.getByRole('button', { name: 'Course only' }));
    expect(screen.getByText(/Drop your course materials here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Drop your course materials here/ })); expect(mocks.upload.handleOpenFilePicker).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Private' })); expect(screen.getAllByText('Private').length).toBeGreaterThan(0);
  });
  it('removes and submits a prepared file once metadata is complete', () => {
    const file = new File(['abc'], 'lesson.pdf', { type: 'application/pdf' }); mocks.upload = { ...mocks.upload, pendingFiles: [file] };
    renderTab(); const selects = screen.getAllByRole('combobox'); fireEvent.change(selects[0], { target: { value: 'c1' } }); fireEvent.change(selects[1], { target: { value: 't1' } }); fireEvent.click(screen.getByRole('button', { name: 'Course only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload Selected (1)' })); expect(mocks.upload.handleUpload).toHaveBeenCalledWith('c1', 'course', 't1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove lesson.pdf' })); expect(mocks.upload.removePendingFile).toHaveBeenCalledWith('lesson.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Clear List' })); expect(mocks.upload.handleCancelUpload).toHaveBeenCalled();
  });
  it('renders pending upload progress and delegates upload list actions', () => {
    const file = new File(['abc'], 'lesson.pdf', { type: 'application/pdf' });
    mocks.upload = { ...mocks.upload, pendingFiles: [file], isUploading: true, currentUploadFileName: 'lesson.pdf', currentUploadFileSize: 3, currentUploadIndex: { current: 1, total: 1 }, currentUploadProgress: 55, currentUploadStatusText: 'Uploading bytes' };
    renderTab(); expect(screen.getByText('1 material ready')).toBeInTheDocument(); expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove lesson.pdf' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Upload' }));
    expect(mocks.upload.handleCancelUpload).toHaveBeenCalled();
  });
  it('renders loading and empty material states', () => {
    mocks.list = { ...mocks.list, materials: [], isLoadingMaterials: true }; const { unmount } = renderTab(); expect(screen.getByText('Loading documents...')).toBeInTheDocument(); unmount();
    mocks.list = { ...mocks.list, materials: [], isLoadingMaterials: false, totalMaterialsCount: 0, visibleMaterialRangeStart: 0, visibleMaterialRangeEnd: 0 }; renderTab(); expect(screen.getByText('No materials match your filters.')).toBeInTheDocument();
  });
  it('selects material rows and updates their academic term in bulk', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Update academic terms' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select lecture.mp4' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select notes.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update selected (2)' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const termSelect = screen.getAllByRole('combobox').at(-1);
    expect(termSelect).toBeDefined();
    fireEvent.change(termSelect!, { target: { value: 't2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ academic_term_id: 't2' }));
    expect(mocks.in).toHaveBeenCalledWith('id', ['m1', 'm2']);
    expect(mocks.list.fetchMaterials).toHaveBeenCalled();
  });
});
