export interface ChatDocumentOption {
  id: string;
  name: string;
  type: string;
}

function getSelectedDocuments(
  documents: ChatDocumentOption[],
  selectedDocumentIds: string[],
): ChatDocumentOption[] {
  const selectedSet = new Set(selectedDocumentIds);
  return documents.filter((document) => selectedSet.has(document.id));
}

export function sanitizeSelectedDocumentIds(
  selectedDocumentIds: string[],
  documents: ChatDocumentOption[],
): string[] {
  const availableIds = new Set(documents.map((document) => document.id));
  return selectedDocumentIds.filter((documentId, index) => (
    availableIds.has(documentId) && selectedDocumentIds.indexOf(documentId) === index
  ));
}

export function getDocumentScopeSummary(
  documents: ChatDocumentOption[],
  selectedDocumentIds: string[],
): string {
  const selectedDocuments = getSelectedDocuments(documents, selectedDocumentIds);

  if (selectedDocuments.length === 0 && documents.length === 0) {
    return "All course documents";
  }

  if (selectedDocuments.length === documents.length) {
    return "All course documents";
  }

  if (selectedDocuments.length === 0) {
    return "No documents — general knowledge only";
  }

  if (selectedDocuments.length === 1) {
    return selectedDocuments[0].name;
  }

  if (selectedDocuments.length === 2) {
    return `${selectedDocuments[0].name} and ${selectedDocuments[1].name}`;
  }

  return `${selectedDocuments.length} selected documents`;
}

export function getDocumentSelectorLabel(
  documents: ChatDocumentOption[],
  selectedDocumentIds: string[],
  isLoading: boolean,
): string {
  if (isLoading) {
    return "Loading documents...";
  }

  if (documents.length === 0) {
    return "No processed documents";
  }

  const selectedDocuments = getSelectedDocuments(documents, selectedDocumentIds);

  if (selectedDocuments.length === documents.length) {
    return 'All materials selected';
  }

  if (selectedDocuments.length === 0) {
    return 'No documents selected.';
  }

  return `${selectedDocuments.length} material${selectedDocuments.length === 1 ? '' : 's'} selected`;
}
