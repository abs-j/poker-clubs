import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';


export default function NotFound() {
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
