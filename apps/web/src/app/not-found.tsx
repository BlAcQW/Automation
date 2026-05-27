import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function NotFound() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
            <Card className="glass-card border-white/5 max-w-md w-full p-8 text-center">
                <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                    <Compass className="w-7 h-7 text-emerald-400" />
                </div>
                <h1 className="text-2xl font-bold text-white">Page not found</h1>
                <p className="text-slate-400 mt-2">
                    The page you’re looking for doesn’t exist or has moved.
                </p>

                <div className="mt-6">
                    <Link href="/">
                        <Button>Go home</Button>
                    </Link>
                </div>
            </Card>
        </div>
    );
}
