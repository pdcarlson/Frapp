/**
 * The metadata a person confirms for each document in a bulk batch (#3499).
 * Every field but the title is "sticky": it carries to the next document,
 * because a folder of exams is usually one course, one professor, one term.
 */
export type BulkFields = {
  title: string;
  department_code: string;
  course_number: string;
  professor_name: string;
  year: string;
  semester: string;
  assignment_type: string;
  assignment_number: string;
  document_variant: string;
  tags: string;
};

export const EMPTY_FIELDS: BulkFields = {
  title: "",
  department_code: "",
  course_number: "",
  professor_name: "",
  year: "",
  semester: "",
  assignment_type: "",
  assignment_number: "",
  // The common case in a backlog, and the safe one: a Student Copy is always
  // flattened.
  document_variant: "Student Copy",
  tags: "",
};

/** Fields that reset per document; the rest carry over. */
export function nextDocumentFields(sticky: BulkFields, fileName: string): BulkFields {
  return { ...sticky, title: titleFromFileName(fileName), assignment_number: "" };
}

function titleFromFileName(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
