import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CoursesOverviewTab } from './CoursesOverviewTab';

const callbacks = () => ({
  onNewCourseNameChange: vi.fn(), onNewCourseCodeChange: vi.fn(), onNewCourseDescriptionChange: vi.fn(),
  onCreateCourse: vi.fn(), onDeleteCourse: vi.fn(), onOpenAddStudentsDialog: vi.fn(),
  onNewTermSemesterChange: vi.fn(), onNewTermAyStartChange: vi.fn(), onCreateAcademicTerm: vi.fn(),
  onSetActiveTerm: vi.fn(), onDeleteAcademicTerm: vi.fn(),
});
const course = { id: 'c1', name: 'Algorithms', code: 'CS101', description: null } as never;
const terms = [
  { id: 't1', label: 'Semester 1 AY2026/2027', semester: 1, academic_year_start: 2026, academic_year_end: 2027, sort_key: 1, is_active: true },
  { id: 't2', label: 'Semester 2 AY2026/2027', semester: 2, academic_year_start: 2026, academic_year_end: 2027, sort_key: 2, is_active: false },
];
function props(extra = {}) { return { isAdmin: true, courses: [course], isLoadingCourses: false, enrollmentCodeByCourseId: { c1: 'JOIN1' }, newCourseName: '', newCourseCode: '', newCourseDescription: '', isCreatingCourse: false, academicTerms: terms, isLoadingTerms: false, newTermSemester: '1' as const, newTermAyStart: '2026', isCreatingTerm: false, activatingTermId: null, ...callbacks(), ...extra }; }
const view = (p = props()) => render(<MemoryRouter><CoursesOverviewTab {...p} /></MemoryRouter>);

describe('CoursesOverviewTab', () => {
  it('renders course and term data and delegates primary actions', () => {
    const p = props(); view(p);
    expect(screen.getByText('Algorithms')).toBeInTheDocument();
    expect(screen.getByText('JOIN1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Students/ })).toHaveAttribute('href', '/admin-dashboard/courses/c1/students');
    fireEvent.change(screen.getByLabelText('Course Name'), { target: { value: 'Databases' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Course' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Algorithms' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set Active' }));
    fireEvent.click(screen.getByRole('button', { name: `Delete ${terms[1].label}` }));
    expect(p.onNewCourseNameChange).toHaveBeenCalledWith('Databases');
    expect(p.onCreateCourse).toHaveBeenCalled(); expect(p.onOpenAddStudentsDialog).toHaveBeenCalledWith(course);
    expect(p.onDeleteCourse).toHaveBeenCalledWith(course); expect(p.onSetActiveTerm).toHaveBeenCalledWith('t2');
    expect(p.onDeleteAcademicTerm).toHaveBeenCalledWith(terms[1]);
  });
  it('represents loading, empty, busy and non-admin states', () => {
    const { unmount } = view(props({ courses: [], academicTerms: [], isLoadingCourses: true, isLoadingTerms: true, isCreatingCourse: true, isCreatingTerm: true }));
    expect(screen.getByText('Loading courses...')).toBeInTheDocument(); expect(screen.getByText('Loading academic terms...')).toBeInTheDocument(); unmount();
    view(props({ isAdmin: false, courses: [], academicTerms: terms, activatingTermId: 't2' }));
    expect(screen.getByText('No courses created yet.')).toBeInTheDocument();
    expect(screen.getAllByText('Admin only')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Create Academic Term' })).not.toBeInTheDocument();
  });
});
