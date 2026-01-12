"use client";

import React, { useState } from 'react';
import { Check, ChevronRight, AlertCircle, Info, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { WorkflowStep, WorkflowContext, WorkflowData } from '@/lib/workflow/types';
import { getWorkflowProgress, canProceedToNext } from '@/lib/workflow/types';

interface WorkflowWizardProps {
    steps: WorkflowStep[];
    onComplete: (data: WorkflowData) => void;
    onCancel?: () => void;
    children?: (stepId: string, data: WorkflowData, updateData: (updates: Partial<WorkflowData>) => void) => React.ReactNode;
}

/**
 * Default step content renderer (placeholder)
 */
function defaultRenderStepContent(
    stepId: string,
    data: WorkflowData,
    updateData: (updates: Partial<WorkflowData>) => void
): React.ReactNode {
    return (
        <div className="flex items-center justify-center border-2 border-dashed rounded-lg p-8">
            <p className="text-slate-400">
                Contenido del paso "{stepId}" aquí. Pasa una función children para renderizar contenido custom.
            </p>
        </div>
    );
}

export function WorkflowWizard({ steps, onComplete, onCancel, children }: WorkflowWizardProps) {
    const renderStepContent = children || defaultRenderStepContent;
    const [context, setContext] = useState<WorkflowContext>({
        currentStep: 0,
        data: {},
        completedSteps: new Set(),
        errors: new Map(),
    });

    const currentStep = steps[context.currentStep];
    const progress = getWorkflowProgress(context);
    const canProceed = canProceedToNext(context, steps);

    const handleNext = () => {
        // Validate current step
        const validation = currentStep.validation(context.data);

        if (!validation.valid && !currentStep.canSkip) {
            setContext({
                ...context,
                errors: new Map(context.errors).set(currentStep.id, validation.errors || []),
            });
            return;
        }

        // Mark as completed
        const newCompleted = new Set(context.completedSteps);
        newCompleted.add(currentStep.id);

        // Move to next step
        if (context.currentStep < steps.length - 1) {
            setContext({
                ...context,
                currentStep: context.currentStep + 1,
                completedSteps: newCompleted,
                errors: new Map(context.errors).set(currentStep.id, []),
            });
        } else {
            // Workflow complete
            onComplete(context.data);
        }
    };

    const handleBack = () => {
        if (context.currentStep > 0) {
            setContext({
                ...context,
                currentStep: context.currentStep - 1,
            });
        }
    };

    const handleSkip = () => {
        if (currentStep.canSkip) {
            const newCompleted = new Set(context.completedSteps);
            newCompleted.add(currentStep.id);

            setContext({
                ...context,
                currentStep: context.currentStep + 1,
                completedSteps: newCompleted,
            });
        }
    };

    const updateData = (updates: Partial<WorkflowData>) => {
        setContext({
            ...context,
            data: { ...context.data, ...updates },
        });
    };

    const errors = context.errors.get(currentStep.id) || [];
    const validation = currentStep.validation(context.data);

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            {/* Progress Header */}
            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>Paso {context.currentStep + 1} de {steps.length}</span>
                    <span>{progress}% completado</span>
                </div>
                <Progress value={progress} className="h-2" />
            </div>

            {/* Step Indicators */}
            <div className="flex items-center justify-between">
                {steps.map((step, index) => (
                    <React.Fragment key={step.id}>
                        <div
                            className={cn(
                                "flex flex-col items-center gap-2 flex-1",
                                index === context.currentStep && "text-blue-600",
                                context.completedSteps.has(step.id) && "text-green-600",
                                index > context.currentStep && "text-slate-400"
                            )}
                        >
                            <div
                                className={cn(
                                    "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                                    index === context.currentStep && "border-blue-600 bg-blue-50",
                                    context.completedSteps.has(step.id) && "border-green-600 bg-green-50",
                                    index > context.currentStep && "border-slate-300"
                                )}
                            >
                                {context.completedSteps.has(step.id) ? (
                                    <Check className="h-5 w-5" />
                                ) : (
                                    <span className="text-sm font-semibold">{index + 1}</span>
                                )}
                            </div>
                            <span className="text-xs font-medium text-center hidden sm:block">
                                {step.title}
                            </span>
                        </div>
                        {index < steps.length - 1 && (
                            <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
                        )}
                    </React.Fragment>
                ))}
            </div>

            {/* Current Step Content */}
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between">
                        <div>
                            <CardTitle className="text-2xl">{currentStep.title}</CardTitle>
                            <CardDescription className="mt-2">{currentStep.description}</CardDescription>
                        </div>
                        {currentStep.estimatedTime && (
                            <div className="flex items-center gap-1 text-sm text-slate-500">
                                <Clock className="h-4 w-4" />
                                <span>{currentStep.estimatedTime}</span>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Errors */}
                    {errors.length > 0 && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                <ul className="list-disc list-inside space-y-1">
                                    {errors.map((error, i) => (
                                        <li key={i}>{error}</li>
                                    ))}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Warnings */}
                    {validation.warnings && validation.warnings.length > 0 && (
                        <Alert>
                            <Info className="h-4 w-4" />
                            <AlertDescription>
                                <ul className="list-disc list-inside space-y-1">
                                    {validation.warnings.map((warning, i) => (
                                        <li key={i}>{warning}</li>
                                    ))}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Step-specific content */}
                    <div className="min-h-[300px]">
                        {/* Pass updateData to allow steps to modify workflow data */}
                        {renderStepContent(currentStep.id, context.data, updateData)}
                    </div>
                </CardContent>
            </Card>

            {/* Navigation */}
            <div className="flex items-center justify-between">
                <Button
                    variant="outline"
                    onClick={handleBack}
                    disabled={context.currentStep === 0}
                >
                    Atrás
                </Button>

                <div className="flex gap-2">
                    {currentStep.canSkip && (
                        <Button variant="ghost" onClick={handleSkip}>
                            Saltar
                        </Button>
                    )}

                    <Button
                        onClick={handleNext}
                        disabled={!canProceed && !currentStep.canSkip}
                    >
                        {context.currentStep === steps.length - 1 ? 'Finalizar' : 'Siguiente'}
                        <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
