import type { ProjectSummary } from '@project/shared-api';
import DeleteContextMenu, { type ContextMenuAnchor } from '@/components/DeleteContextMenu';

export interface ProjectMenuAnchor extends ContextMenuAnchor {
  projectId: string;
}
export default function ProjectContextMenu({
  project,
  anchor,
  onClose,
  onDelete,
}: {
  project: ProjectSummary;
  anchor: ProjectMenuAnchor;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <DeleteContextMenu
      title={project.name}
      label="工程"
      anchor={anchor}
      onClose={onClose}
      onDelete={onDelete}
    />
  );
}
