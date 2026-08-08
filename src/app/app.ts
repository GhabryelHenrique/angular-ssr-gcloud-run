import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TelemetryBar } from './shared/telemetry-bar/telemetry-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TelemetryBar],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
