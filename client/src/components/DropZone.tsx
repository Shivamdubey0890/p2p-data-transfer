import { Box, Typography } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { DragEvent, useRef, useState } from 'react';

interface Props {
  disabled?: boolean;
  onFiles(files: File[]): void;
}

interface WebkitEntry {
  isFile: boolean;
  isDirectory: boolean;
  file(cb: (f: File) => void, err: (e: unknown) => void): void;
  createReader(): {
    readEntries(cb: (entries: WebkitEntry[]) => void, err: (e: unknown) => void): void;
  };
}

/** Dropped folders arrive as 0-byte pseudo-files — walk them for real files. */
async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  // Entries must be grabbed synchronously, before any await.
  const entries = Array.from(dt.items ?? [])
    .map((item) => (item as { webkitGetAsEntry?: () => WebkitEntry | null }).webkitGetAsEntry?.())
    .filter((e): e is WebkitEntry => Boolean(e));
  if (entries.length === 0) return Array.from(dt.files);

  const files: File[] = [];
  const walk = async (entry: WebkitEntry): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => entry.file(res, rej)).catch(() => null);
      if (f) files.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns batches (Chrome: ≤100) — loop until drained.
      let batch: WebkitEntry[];
      do {
        batch = await new Promise<WebkitEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child);
      } while (batch.length > 0);
    }
  };
  for (const entry of entries) await walk(entry);
  return files;
}

export function DropZone({ disabled, onFiles }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    void collectDroppedFiles(e.dataTransfer).then((files) => {
      if (files.length) onFiles(files);
    });
  };

  return (
    <Box
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      sx={{
        border: '2px dashed',
        borderColor: dragging ? 'primary.main' : 'divider',
        borderRadius: 2,
        p: 3,
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        bgcolor: dragging ? 'action.hover' : 'transparent',
        transition: 'all 120ms ease',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      <CloudUploadIcon color={dragging ? 'primary' : 'disabled'} sx={{ fontSize: 40 }} />
      <Typography color="text.secondary">
        {disabled
          ? 'Connect to a device to send files'
          : 'Drag & drop files or folders here, or click to browse'}
      </Typography>
    </Box>
  );
}
