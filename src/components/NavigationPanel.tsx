import { ArrowUp, ArrowLeft, ArrowRight, RotateCcw, Merge, Flag } from 'lucide-react';

interface RouteStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
}

interface NavigationPanelProps {
  steps: RouteStep[];
  currentStepIndex: number;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${Math.round(meters / 100) / 10} km`;
  }
  return `${Math.round(meters / 10) * 10} m`;
}

function getManeuverIcon(type: string, modifier?: string): React.ReactNode {
  switch (type) {
    case 'turn':
      if (modifier === 'left' || modifier === 'slight left' || modifier === 'sharp left') {
        return <ArrowLeft size={32} className="text-white" />;
      }
      if (modifier === 'right' || modifier === 'slight right' || modifier === 'sharp right') {
        return <ArrowRight size={32} className="text-white" />;
      }
      if (modifier === 'straight') {
        return <ArrowUp size={32} className="text-white" />;
      }
      if (modifier === 'uturn') {
        return <RotateCcw size={32} className="text-white" />;
      }
      return <ArrowUp size={32} className="text-white" />;
    case 'new name':
    case 'continue':
      return <ArrowUp size={32} className="text-white" />;
    case 'merge':
      return <Merge size={32} className="text-white" />;
    case 'roundabout':
      return <RotateCcw size={32} className="text-white" />;
    case 'arrive':
      return <Flag size={32} className="text-green-400" />;
    case 'depart':
      return <Flag size={32} className="text-blue-400" />;
    case 'fork':
      if (modifier === 'left') {
        return <ArrowLeft size={32} className="text-white" />;
      }
      if (modifier === 'right') {
        return <ArrowRight size={32} className="text-white" />;
      }
      return <ArrowUp size={32} className="text-white" />;
    default:
      return <ArrowUp size={32} className="text-white" />;
  }
}

function getManeuverText(type: string, modifier?: string, name?: string, instruction?: string): string {
  switch (type) {
    case 'turn':
      const turnDir = modifier || 'rechtdoor';
      return `Sla ${turnDir === 'left' ? 'linksaf' : turnDir === 'right' ? 'rechtsaf' : 'rechtdoor'}${name ? ` op ${name}` : ''}`;
    case 'new name':
      return `Ga door${name ? ` op ${name}` : ''}`;
    case 'continue':
      return `Blijf volgen${name ? ` ${name}` : ''}`;
    case 'merge':
      return `Voeg in${name ? ` op ${name}` : ''}`;
    case 'roundabout':
      return `Neem de rotonde${name ? ` ${name}` : ''}`;
    case 'arrive':
      return 'Bestemming bereikt';
    case 'depart':
      return 'Start navigatie';
    case 'fork':
      const forkDir = modifier === 'left' ? 'links' : modifier === 'right' ? 'rechts' : 'rechtdoor';
      return `Blijf ${forkDir}${name ? ` op ${name}` : ''}`;
    default:
      return instruction || 'Volg de route';
  }
}

export default function NavigationPanel({ steps, currentStepIndex }: NavigationPanelProps) {
  const currentStep = steps[currentStepIndex];
  const nextStep = steps[currentStepIndex + 1];

  if (!currentStep) return null;

  return (
    <div className="bg-slate-800/95 border-t border-slate-700 px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 flex items-center justify-center bg-blue-600 rounded-xl">
          {getManeuverIcon(currentStep.maneuver.type, currentStep.maneuver.modifier)}
        </div>
        <div className="flex-1">
          <div className="text-2xl font-bold text-white">
            {formatDistance(currentStep.distance)}
          </div>
          <div className="text-sm text-slate-300">
            {getManeuverText(
              currentStep.maneuver.type,
              currentStep.maneuver.modifier,
              currentStep.name,
              currentStep.instruction
            )}
          </div>
        </div>
      </div>

      {nextStep && (
        <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center">
            {getManeuverIcon(nextStep.maneuver.type, nextStep.maneuver.modifier)}
          </div>
          <div className="flex-1 text-xs text-slate-400">
            <span className="text-slate-300">{formatDistance(nextStep.distance)}</span>
            <span className="ml-2">
              {getManeuverText(
                nextStep.maneuver.type,
                nextStep.maneuver.modifier,
                nextStep.name,
                nextStep.instruction
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
