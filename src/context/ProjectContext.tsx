"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Project } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';

interface ProjectContextType {
    projects: Project[];
    currentProject: Project | null;
    createProject: (name: string, client: string, notes?: string) => Promise<void>;
    selectProject: (id: string) => void;
    deleteProject: (id: string) => Promise<void>;
    loading: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchProjects = useCallback(async () => {
        if (!user) {
            setProjects([]);
            return;
        }
        setLoading(true);
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .eq('user_id', user.uid)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching projects", error);
        } else {
            // Map SQL columns to Typescript keys if needed (camelCase vs snake_case)
            // Projects table uses user_id, client_name, created_at.
            // Our TS Project type might need adjustment or mapping.
            const mappedProjects: Project[] = (data || []).map(p => ({
                id: p.id,
                name: p.name,
                client: p.client_name,
                notes: p.notes,
                createdAt: p.created_at
            }));
            setProjects(mappedProjects);
        }
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    const createProject = async (name: string, client: string, notes?: string) => {
        if (!user) return;
        const { data, error } = await supabase.from('projects').insert({
            user_id: user.uid,
            name,
            client_name: client,
            notes
        }).select().single();

        if (error) {
            console.error("Error creating project", error);
            throw error;
        } else if (data) {
            const newProject: Project = {
                id: data.id,
                name: data.name,
                client: data.client_name,
                notes: data.notes,
                createdAt: data.created_at
            };
            setProjects(prev => [newProject, ...prev]);
            setCurrentProject(newProject);
        }
    };

    const selectProject = (id: string) => {
        const p = projects.find(proj => proj.id === id);
        if (p) setCurrentProject(p);
    };

    const deleteProject = async (id: string) => {
        if (!user) return;
        const { error } = await supabase.from('projects').delete().eq('id', id);
        if (error) {
            console.error(error);
            return;
        }
        setProjects(prev => prev.filter(p => p.id !== id));
        if (currentProject?.id === id) {
            setCurrentProject(null);
        }
    };

    return (
        <ProjectContext.Provider value={{ projects, currentProject, createProject, selectProject, deleteProject, loading }}>
            {children}
        </ProjectContext.Provider>
    );
}

export function useProject() {
    const context = useContext(ProjectContext);
    if (context === undefined) {
        throw new Error('useProject must be used within a ProjectProvider');
    }
    return context;
}
