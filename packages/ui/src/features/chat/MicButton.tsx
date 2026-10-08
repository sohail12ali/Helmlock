// Browser Web Speech dictation (F12). Absent when the browser has no SpeechRecognition. Nothing listens until the
// person clicks it; the tooltip says some browsers send the audio to a vendor for recognition.
import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

export function speechRecognition(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const MIC_CAVEAT = "Dictate with the browser's speech recognition. Off until you click. Some browsers send the audio to a vendor to recognise it.";

export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const Ctor = speechRecognition();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => () => rec.current?.stop(), []);
  if (!Ctor) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    setError(undefined);
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res?.isFinal && res[0]) cb.current(res[0].transcript);
      }
    };
    r.onerror = (e) => setError(e.error);
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("could not start");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate"}
      title={error ? `Dictation error: ${error}. ${MIC_CAVEAT}` : MIC_CAVEAT}
      className={cn(listening && "bg-destructive/10 text-destructive")}
    >
      {listening ? <MicOff /> : <Mic />}
    </Button>
  );
}
