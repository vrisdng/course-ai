import {
  FileText,
  Image,
  FileSpreadsheet,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface Material {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  processing_status: string;
  processing_error: string | null;
  created_at: string;
}

interface MaterialsListProps {
  materials: Material[];
  onDelete: (id: string) => void;
}

function getFileIcon(type: string) {
  switch (type) {
    case 'image':
      return <Image className="h-5 w-5 text-info" />;
    case 'pptx':
    case 'slides':
      return <FileSpreadsheet className="h-5 w-5 text-warning" />;
    default:
      return <FileText className="h-5 w-5 text-primary" />;
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'processing':
      return <Loader2 className="h-4 w-4 animate-spin text-warning" />;
    case 'pending':
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    default:
      return null;
  }
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'processing':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MaterialsList({ materials, onDelete }: MaterialsListProps) {
  if (materials.length === 0) return null;

  return (
    <div className="grid gap-3">
      {materials.map((material) => (
        <Card key={material.id}>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                {getFileIcon(material.file_type)}
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{material.file_name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(material.file_size)}
                  {material.file_size ? ' • ' : ''}
                  {new Date(material.created_at).toLocaleDateString()}
                </p>
                {material.processing_error && (
                  <p className="mt-1 truncate text-xs text-destructive">
                    {material.processing_error}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <Badge variant={getStatusVariant(material.processing_status)} className="capitalize gap-1">
                {getStatusIcon(material.processing_status)}
                <span>{material.processing_status}</span>
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(material.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
