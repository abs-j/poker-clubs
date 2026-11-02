import { useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { IS_DEMO } from '@/lib/demo-flag';

/** True for exactly /demo and /demo/ (not /demo/index.html), where the static host may have served this app instead. */
export const isDemoEntryPath = (pathname: string) => pathname === '/demo' || pathname === '/demo/';

export default function NotFound() {
  // Some static hosts rewrite every URL to this app's index.html, even the demo's folder URL.
  // The demo's own index.html is a real file, so go straight to it. Only once, so it cannot loop.
  const toDemo = !IS_DEMO && typeof window !== 'undefined' && isDemoEntryPath(window.location.pathname);
  useEffect(() => {
    if (toDemo) window.location.replace(`/demo/index.html${window.location.search}`);
  }, [toDemo]);
  if (toDemo) return null;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold">Page not found</h1>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">That page doesn&apos;t exist, or the link has changed.</p>
          <a href="/" className="mt-5 inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Go to the home page
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
