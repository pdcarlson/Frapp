export type Semester = 'Spring' | 'Summer' | 'Fall' | 'Winter';

export type AssignmentType =
  | 'Exam'
  | 'Midterm'
  | 'Final Exam'
  | 'Quiz'
  | 'Homework'
  | 'Lab'
  | 'Project'
  | 'Study Guide'
  | 'Notes'
  | 'Other';

export type DocumentVariant = 'Student Copy' | 'Blank Copy' | 'Answer Key';

export interface BackworkDepartment {
  id: string;
  chapter_id: string;
  code: string;
  name: string | null;
  created_at: string;
}

export interface BackworkProfessor {
  id: string;
  chapter_id: string;
  name: string;
  created_at: string;
}

export interface BackworkResource {
  id: string;
  chapter_id: string;
  department_id: string | null;
  course_number: string | null;
  professor_id: string | null;
  uploader_id: string;
  title: string | null;
  year: number | null;
  semester: Semester | null;
  assignment_type: AssignmentType | null;
  assignment_number: number | null;
  document_variant: DocumentVariant | null;
  storage_path: string;
  file_hash: string;
  is_redacted: boolean;
  tags: string[];
  created_at: string;
}
