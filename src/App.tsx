import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileUp, FileImage, FileText, Download, Loader2, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { convertPdfToImages, fileToBase64 } from './lib/pdf-utils';
import { processDocumentPage } from './lib/ai-service';
import { exportToDocx } from './lib/docx-exporter';

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; text: string }>({ current: 0, total: 0, text: '' });
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(acceptedFiles);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    },
    maxFiles: 1
  });

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData && e.clipboardData.files.length > 0) {
        const pastedFiles = Array.from(e.clipboardData.files);
        const validFiles = pastedFiles.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
        if (validFiles.length > 0) {
          setFiles([validFiles[0]]);
          setError(null);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleConvert = async () => {
    if (files.length === 0) return;
    
    setIsProcessing(true);
    setError(null);
    setResults([]);
    setImages([]);
    
    try {
      const file = files[0];
      let base64Images: string[] = [];
      
      setProgress({ current: 0, total: 0, text: 'Reading file...' });
      
      if (file.type === 'application/pdf') {
        setProgress({ current: 0, total: 0, text: 'Converting PDF to images...' });
        base64Images = await convertPdfToImages(file);
      } else if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        base64Images = [base64];
      } else {
        throw new Error('Unsupported file type');
      }
      
      setImages(base64Images);
      
      const newResults: string[] = new Array(base64Images.length).fill('');
      let completedCount = 0;
      
      const processPage = async (index: number) => {
        try {
          const markdown = await processDocumentPage(base64Images[index], () => {
            // We disable real-time partial updates here to avoid UI lag during parallel processing
          });
          newResults[index] = markdown;
        } catch (e) {
          console.error(`Error processing page ${index + 1}:`, e);
          newResults[index] = `*Error processing page ${index + 1}*`;
        } finally {
          completedCount++;
          setProgress({ 
            current: completedCount, 
            total: base64Images.length, 
            text: `Processed ${completedCount} of ${base64Images.length} pages...` 
          });
          setResults([...newResults]);
        }
      };

      // Run with concurrency limit of 10 to process all pages at once
      const concurrencyLimit = 10;
      for (let i = 0; i < base64Images.length; i += concurrencyLimit) {
        const chunk = [];
        for (let j = 0; j < concurrencyLimit && i + j < base64Images.length; j++) {
          chunk.push(processPage(i + j));
        }
        await Promise.all(chunk);
      }
      
      setProgress({ current: base64Images.length, total: base64Images.length, text: 'Conversion complete!' });
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during conversion');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportWord = async () => {
    if (results.length === 0) return;
    
    try {
      const combinedMarkdown = results.join('\n\n---\n\n');
      const blob = await exportToDocx(combinedMarkdown);
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Converted_Document.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setError('Failed to export Word document: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-teal-50 text-teal-950 font-sans selection:bg-teal-200">
      <header className="bg-teal-600 text-white shadow-md py-6 px-8">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <FileText className="w-8 h-8" />
          <h1 className="text-2xl font-bold tracking-tight">DocuTeal Converter</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Input */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileUp className="w-5 h-5 text-teal-600" />
              Upload Document
            </h2>
            
            <div 
              {...getRootProps()} 
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-teal-500 bg-teal-50' : 'border-teal-200 hover:border-teal-400 hover:bg-teal-50/50'}`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-3">
                <div className="p-4 bg-teal-100 text-teal-600 rounded-full">
                  <FileImage className="w-8 h-8" />
                </div>
                <div>
                  <p className="font-medium text-teal-800">Drag & drop a PDF or Image here</p>
                  <p className="text-sm text-teal-600/70 mt-1">or click to browse, or paste (Ctrl+V)</p>
                </div>
                <p className="text-xs text-teal-500 mt-2">PDFs limited to 10 pages</p>
              </div>
            </div>

            {files.length > 0 && (
              <div className="mt-4 p-3 bg-teal-50 rounded-lg border border-teal-100 flex items-center justify-between">
                <span className="text-sm font-medium truncate">{files[0].name}</span>
                <span className="text-xs text-teal-600 bg-teal-100 px-2 py-1 rounded-md font-mono">
                  {(files[0].size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex items-start gap-2 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <button
              onClick={handleConvert}
              disabled={files.length === 0 || isProcessing}
              className="w-full mt-6 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Converting...
                </>
              ) : (
                'Convert to Word'
              )}
            </button>
          </div>

          {isProcessing && (
            <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-6">
              <h3 className="text-sm font-semibold text-teal-800 mb-2">Processing Status</h3>
              <div className="w-full bg-teal-100 rounded-full h-2.5 mb-2 overflow-hidden">
                <div 
                  className="bg-teal-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 10}%` }}
                ></div>
              </div>
              <p className="text-sm text-teal-600">{progress.text}</p>
            </div>
          )}
        </div>

        {/* Right Column: Output */}
        <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-6 flex flex-col h-[calc(100vh-8rem)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-teal-600" />
              Preview
            </h2>
            <button
              onClick={handleExportWord}
              disabled={results.length === 0 || isProcessing}
              className="bg-teal-100 hover:bg-teal-200 text-teal-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export .docx
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-teal-50/50 rounded-xl border border-teal-100 p-6 prose prose-teal prose-sm max-w-none">
            {results.length > 0 ? (
              results.map((res, idx) => (
                <div key={idx} className="mb-8 pb-8 border-b border-teal-200 last:border-0">
                  <div className="text-xs text-teal-500 font-mono mb-4 uppercase tracking-wider">Page {idx + 1}</div>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(value: string) => value}
                  >
                    {res}
                  </ReactMarkdown>
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-teal-400">
                <FileText className="w-12 h-12 mb-3 opacity-50" />
                <p>Converted content will appear here</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

