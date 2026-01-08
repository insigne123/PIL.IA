"use client";

import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

export function LoginForm() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                if (displayName) {
                    await updateProfile(userCredential.user, {
                        displayName: displayName
                    });
                }
            }
            router.push('/');
        } catch (err: any) {
            console.error(err);
            let msg = "Error de autenticación.";
            if (err.code === 'auth/email-already-in-use') msg = "El correo ya está registrado.";
            if (err.code === 'auth/weak-password') msg = "La contraseña debe tener al menos 6 caracteres.";
            if (err.code === 'auth/invalid-credential') msg = "Credenciales inválidas.";
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="w-full max-w-md mx-auto mt-20">
            <CardHeader>
                <CardTitle className="text-2xl font-bold text-center">YAGO</CardTitle>
                <CardDescription className="text-center">
                    {isLogin ? "Cubicación y Presupuesto Asistido" : "Crea tu cuenta para comenzar"}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleAuth} className="space-y-4">
                    {!isLogin && (
                        <div className="space-y-2">
                            <Input
                                type="text"
                                placeholder="Nombre de Usuario"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                required
                            />
                        </div>
                    )}
                    <div className="space-y-2">
                        <Input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            type="password"
                            placeholder="Contraseña"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    {error && (
                        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-2 rounded">
                            <AlertCircle className="h-4 w-4" />
                            <span>{error}</span>
                        </div>
                    )}
                    <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading}>
                        {loading ? "Procesando..." : (isLogin ? "Iniciar Sesión" : "Registrarse")}
                    </Button>
                </form>
            </CardContent>
            <CardFooter className="justify-center">
                <Button variant="link" onClick={() => setIsLogin(!isLogin)} className="text-slate-600">
                    {isLogin ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia Sesión"}
                </Button>
            </CardFooter>
        </Card>
    );
}
