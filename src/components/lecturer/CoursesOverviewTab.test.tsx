import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CoursesOverviewTab } from './CoursesOverviewTab';

const courses = [
  { id: 'course-1', name: 'Algorithms', code: 'CS101' },
  { id: 'course-2', name: 'Databases', code: null },
];
const terms = [
  { id: 'term-1', label: 'AY2026/27 Semester 1', semester: 1, academic_year_start: 2026, academic_year_end: 2027, sort_key: 1, is_active: true },
  { id: 'term-2', label: 'AY2026/27 Semester 2', semester: 2, academic_year_start: 2026, academic_year_end: 2027, sort_key: 2, is_active: false },
];

const props = () => ({
  isAdmin: true, courses, isLoadingCourses: false, enrollmentCodeByCourseId: { 'course-1': 'AB3X7KM2' },
  newCourseName: '', newCourseCode: '', newCourseDescription: '', isCreatingCourse: false,
  onNewCourseNameChange: vi.fn(), onNewCourseCodeChange: vi.fn(), onNewCourseDescriptionChange: vi.fn(),
  onCreateCourse: vi.fn(), onDeleteCourse: vi.fn(), onOpenAddStudentsDialog: vi.fn(),
  academicTerms: terms, isLoadingTerms: false, newTermSemester: '1' as const, newTermAyStart: '2026', isCreatingTerm: false,
  activatingTermId: null, onNewTermSemesterChange: vi.fn(), onNewTermAyStartChange: vi.fn(), onCreateAcademicTerm: vi.fn(),
  onSetActiveTerm: vi.fn(), onDeleteAcademicTerm: vi.fn(),
});
const renderTab = (value = props()) => render(<MemoryRouter><CoursesOverviewTab {...value} /></MemoryRouter>);

describe('CoursesOverviewTab', () => {
  it('lists courses with enrollment codes and wires row actions', () => {
    const value = props(); renderTab(value);
    const row = screen.getByText('Algorithms').closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText('AB3X7KM2')).toBeInTheDocument();
    expect(within(screen.getByText('Databases').closest('tr') as HTMLElement).getByText('N/A')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Generate Code' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete Algorithms' }));
    expect(value.onOpenAddStudentsDialog).toHaveBeenCalledWith(courses[0]);
    expect(value.onDeleteCourse).toHaveBeenCalledWith(courses[0]);
    expect(within(row).getByRole('link', { name: 'Students' })).toHaveAttribute('href', '/admin-dashboard/courses/course-1/students');
  });

  it('stacks course and term rows into labelled cards below the sm breakpoint', () => {
    renderTab();
    const courseRow = screen.getByText('Algorithms').closest('tr') as HTMLTableRowElement;
    expect(courseRow.className).toContain('sm:table-row');
    expect(within(courseRow).getByText('AB3X7KM2')).toHaveAttribute('data-label', 'Enrollment code');
    expect(within(courseRow).getByText('CS101')).toHaveAttribute('data-label', 'Code');
    expect(screen.getByRole('columnheader', { name: 'Enrollment Code' }).closest('thead')?.className).toContain('hidden');
    const termRow = screen.getByText('AY2026/27 Semester 2').closest('tr') as HTMLTableRowElement;
    expect(termRow.className).toContain('sm:table-row');
    expect(within(termRow).getByText('Inactive').closest('td')).toHaveAttribute('data-label', 'Status');
  });

  it('activates and deletes inactive terms but protects the active one', () => {
    const value = props(); renderTab(value);
    const inactive = screen.getByText('AY2026/27 Semester 2').closest('tr') as HTMLTableRowElement;
    fireEvent.click(within(inactive).getByRole('button', { name: 'Set Active' }));
    fireEvent.click(within(inactive).getByRole('button', { name: 'Delete AY2026/27 Semester 2' }));
    expect(value.onSetActiveTerm).toHaveBeenCalledWith('term-2');
    expect(value.onDeleteAcademicTerm).toHaveBeenCalledWith(terms[1]);
    const active = screen.getByText('AY2026/27 Semester 1').closest('tr') as HTMLTableRowElement;
    expect(within(active).getByRole('button', { name: 'Active' })).toBeDisabled();
    expect(within(active).getByRole('button', { name: 'Delete AY2026/27 Semester 1' })).toBeDisabled();
  });

  it('hides term management from non-admins and shows loading and empty states', () => {
    const value = props(); value.isAdmin = false; value.courses = []; value.isLoadingTerms = true;
    renderTab(value);
    expect(screen.getByText('No courses created yet.')).toBeInTheDocument();
    expect(screen.getByText('Loading academic terms...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Academic Term' })).not.toBeInTheDocument();
  });
});
